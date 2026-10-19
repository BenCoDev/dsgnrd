import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page, type Frame } from 'playwright';
import { z } from 'zod';
import { prototypePreview, previewCSP, type Prototype } from './prototype';

export const viewportSchema = z.object({ width: z.number().int().min(320).max(1440), height: z.number().int().min(480).max(1200) });
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), selector: z.string().min(1).max(200) }),
  z.object({ type: z.literal('fill'), selector: z.string().min(1).max(200), value: z.string().max(2000) }),
  z.object({ type: z.literal('press'), key: z.enum(['Tab', 'Shift+Tab', 'Enter', 'Space', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) }),
  z.object({ type: z.literal('scroll'), deltaY: z.number().int().min(-1200).max(1200) }),
  z.object({ type: z.literal('wait'), milliseconds: z.number().int().min(0).max(2000) }),
]);
type Action = z.infer<typeof actionSchema>;
export type Viewport = z.infer<typeof viewportSchema>;
export type PrototypeTarget = { author: number; revision: string; previewPath: string };
export type Observation = PrototypeTarget & {
  session: string; observation: number; inspectedAt: string; viewport: Viewport;
  reducedMotion: boolean; text: string; errors: string[]; blockedRequests: number; png: string;
  diagnostics: { horizontalOverflow: boolean; controls: { tag: string; id: string; name: string; width: number; height: number; focused: boolean }[] };
};
export interface PrototypeBrowser {
  open(prototype: Prototype, target: PrototypeTarget, viewport: Viewport, reducedMotion: boolean): Promise<Observation>;
  act(session: string, observation: number, action: Action): Promise<Observation>;
  close(): Promise<void>;
}

export class LocalPrototypeBrowser implements PrototypeBrowser {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private frame?: Frame;
  private target?: PrototypeTarget;
  private session = '';
  private observation = 0;
  private operations = 0;
  private expires = 0;
  private errors: string[] = [];
  private blockedRequests = 0;
  private viewport: Viewport = { width: 390, height: 844 };
  private reducedMotion = false;
  private expiryTimer?: ReturnType<typeof setTimeout>;

  async open(prototype: Prototype, target: PrototypeTarget, viewport: Viewport, reducedMotion: boolean) {
    await this.close();
    this.viewport = viewportSchema.parse(viewport);
    this.reducedMotion = reducedMotion;
    this.target = target;
    this.session = randomUUID(); this.observation = 0; this.operations = 0;
    this.errors = []; this.blockedRequests = 0;
    this.expires = Date.now() + 10 * 60_000;
    try {
      this.browser = await chromium.launch({ headless: true, chromiumSandbox: true });
      this.expiryTimer = setTimeout(() => { void this.close().catch(() => {}); }, 10 * 60_000);
      this.expiryTimer.unref();
      this.context = await this.browser.newContext({ viewport, deviceScaleFactor: 1,
        serviceWorkers: 'block', acceptDownloads: false, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
      // No external server, credentials, cookies, remote fetches or filesystem URLs.
      // Fulfill one synthetic document, abort every subsequent request (including navigation).
      let served = false;
      await this.context.route('**/*', async route => {
        if (!served && route.request().isNavigationRequest() && route.request().url() === 'http://prototype.invalid/') {
          served = true;
          await route.fulfill({ status: 200, contentType: 'text/html', headers: { 'Content-Security-Policy': previewCSP }, body: prototypePreview(prototype) });
        } else { this.blockedRequests++; await route.abort(); }
      });
      await this.context.routeWebSocket('**/*', socket => socket.close());
      this.page = await this.context.newPage();
      this.page.setDefaultTimeout(4000);
      this.page.setDefaultNavigationTimeout(8000);
      this.page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
      this.page.on('pageerror', error => { if (this.errors.length < 10) this.errors.push(error.message.slice(0, 500)); });
      this.page.on('console', message => { if (message.type() === 'error' && this.errors.length < 10) this.errors.push(message.text().slice(0, 500)); });
      await this.page.goto('http://prototype.invalid/', { waitUntil: 'load' });
      this.frame = this.page.frames().find(frame => frame.parentFrame() === this.page!.mainFrame());
      if (!this.frame) throw new Error('Prototype frame did not load.');
      return await this.capture();
    } catch (error) { await this.close(); throw error; }
  }
  async act(session: string, observation: number, action: Action) {
    if (!this.page || !this.frame || session !== this.session) throw new Error('Unknown prototype session; inspect a saved revision first.');
    if (Date.now() > this.expires || this.operations >= 40) {
      await this.close(); throw new Error('Prototype session expired or action limit reached. Inspect again to reset.');
    }
    if (observation !== this.observation) throw new Error('Stale observation; use the most recent screenshot.');
    this.operations++; this.observation++; // Even failed actions invalidate stale handles.
    try {
      switch (action.type) {
        case 'click': await this.frame.locator(action.selector).click(); break;
        case 'fill': await this.frame.locator(action.selector).fill(action.value); break;
        case 'press': await this.page.keyboard.press(action.key); break;
        case 'scroll': await this.page.mouse.move(this.viewport.width / 2, this.viewport.height / 2); await this.page.mouse.wheel(0, action.deltaY); break;
        case 'wait': await this.page.waitForTimeout(action.milliseconds); break;
      }
      return await this.capture();
    } catch (error) {
      // Action may have changed state before timing out; never leave a replayable stale handle.
      await this.close(); throw error;
    }
  }
  private async capture(): Promise<Observation> {
    const page = this.page!, frame = this.frame!;
    await page.waitForTimeout(120);
    // Fixed inspection code only. Authored JavaScript runs solely in the sandboxed iframe.
    const details = await Promise.race([
      frame.evaluate(() => {
        const controls = Array.from(document.querySelectorAll('button,input,select,textarea,a,[role="button"]')).slice(0, 100).map(el => {
          const rect = el.getBoundingClientRect();
          return { tag: el.tagName.toLowerCase(), id: el.id, name: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 100), width: Math.round(rect.width), height: Math.round(rect.height), focused: document.activeElement === el };
        }).filter(el => el.width > 0 && el.height > 0);
        return { text: document.body.innerText.slice(0, 12000), diagnostics: { horizontalOverflow: document.documentElement.scrollWidth > innerWidth, controls } };
      }),
      new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('Prototype inspection timed out.')), 5000); timer.unref(); }),
    ]);
    const png = await page.screenshot({ type: 'png', timeout: 5000 });
    if (png.length > 2_000_000) throw new Error('Prototype screenshot exceeds 2MB.');
    this.observation++;
    return { ...this.target!, session: this.session, observation: this.observation, inspectedAt: new Date().toISOString(), viewport: this.viewport,
      reducedMotion: this.reducedMotion, ...details, errors: [...this.errors], blockedRequests: this.blockedRequests, png: png.toString('base64') };
  }
  async close() {
    clearTimeout(this.expiryTimer); this.expiryTimer = undefined;
    const browser = this.browser;
    this.browser = undefined; this.context = undefined; this.page = undefined; this.frame = undefined; this.session = '';
    if (browser) await browser.close();
  }
}
