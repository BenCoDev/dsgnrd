import { mkdir, readFile, writeFile, rename, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthTokens, OAuthClientInformationMixed, OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';

export const MOBBIN_URL = new URL('https://api.mobbin.com/mcp');
export const LOGIN_REQUIRED = 'Mobbin authorization required. Run: npx tsx src/dsgnrd.ts mobbin login';
export const mobbinDirectory = () => process.env.DSGNRD_MOBBIN_DIR || join(homedir(), '.config', 'dsgnrd', 'mobbin');
type Credentials = { client?: OAuthClientInformationMixed; tokens?: OAuthTokens; redirect?: string };

// All remote requests and credential writes share this cross-process lock. In particular,
// two agents cannot exchange the same rotating refresh token concurrently.
export async function withMobbinLock<T>(fn: () => Promise<T>, directory = mobbinDirectory()): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const lock = join(directory, 'lock');
  const until = Date.now() + 30000;
  while (true) {
    try { await mkdir(lock, { mode: 0o700 }); break; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if (Date.now() >= until) throw new Error('Mobbin is busy in another process. If a process crashed, remove its lock directory after confirming no Mobbin command is running.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  try { return await fn(); } finally { await rm(lock, { recursive: true, force: true }); }
}

export class MobbinAuth implements OAuthClientProvider {
  private data: Credentials = {};
  private verifier?: string;
  private nonce = randomUUID();
  constructor(private directory = mobbinDirectory(), private onRedirect?: (url: URL) => void, private redirect?: string) {}
  async load() {
    try { this.data = JSON.parse(await readFile(join(this.directory, 'credentials.json'), 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Cannot read Mobbin credentials. Disconnect and sign in again.'); }
    return this;
  }
  get redirectUrl() { return this.redirect || this.data.redirect || 'http://127.0.0.1:49153/callback'; }
  get clientMetadata(): OAuthClientMetadata { return { client_name: 'dsgnrd', redirect_uris: [this.redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'openid' }; }
  state() { return this.nonce; }
  clientInformation() { return this.data.client; }
  tokens() { return this.data.tokens; }
  async saveClientInformation(client: OAuthClientInformationMixed) { this.data.client = client; this.data.redirect = this.redirectUrl; await this.save(); }
  async saveTokens(tokens: OAuthTokens) { this.data.tokens = tokens; await this.save(); }
  redirectToAuthorization(url: URL) { if (!this.onRedirect) throw new Error(LOGIN_REQUIRED); this.onRedirect(url); }
  saveCodeVerifier(verifier: string) { this.verifier = verifier; }
  codeVerifier() { if (!this.verifier) throw new Error(LOGIN_REQUIRED); return this.verifier; }
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all') this.data = {};
    if (scope === 'client') delete this.data.client;
    if (scope === 'tokens') delete this.data.tokens;
    if (scope === 'all' || scope === 'verifier') this.verifier = undefined;
    await this.save();
  }
  private async save() {
    const temporary = join(this.directory, `credentials-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(this.data), { mode: 0o600, flag: 'wx' });
      await rename(temporary, join(this.directory, 'credentials.json'));
    } finally { await rm(temporary, { force: true }); }
  }
}

export const boundedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });

export async function loginMobbin(print: (message: string) => void = console.log) {
  return withMobbinLock(async () => {
    let provider: MobbinAuth | undefined;
    let resolveCode!: (code: string) => void;
    let rejectCode!: (error: Error) => void;
    const code = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
    // Attach a handler immediately: a denied callback can arrive during discovery.
    void code.catch(() => {});
    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (!provider || url.pathname !== '/callback' || url.searchParams.get('state') !== provider.state()) { res.writeHead(400).end('Invalid OAuth callback.'); return; }
      if (url.searchParams.has('error') || !url.searchParams.get('code')) { res.writeHead(400).end('Authorization declined.'); rejectCode(new Error('Mobbin authorization declined.')); return; }
      res.setHeader('Content-Type', 'text/plain');
      res.end('Authorization received. Return to your terminal.');
      resolveCode(url.searchParams.get('code')!);
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Cannot start OAuth callback.');
    const timeout = setTimeout(() => rejectCode(new Error('Mobbin sign-in timed out. Run login again.')), 300000);
    const interrupted = () => rejectCode(new Error('Mobbin sign-in interrupted.'));
    process.once('SIGINT', interrupted);
    process.once('SIGTERM', interrupted);
    try {
      provider = await new MobbinAuth(mobbinDirectory(), url => print(`Open this URL to authorize Mobbin:\n${url.href}`), `http://127.0.0.1:${address.port}/callback`).load();
      // A new redirect port requires a fresh dynamic registration.
      await provider.invalidateCredentials('all');
      const result = await auth(provider, { serverUrl: MOBBIN_URL, scope: 'openid', fetchFn: boundedFetch });
      if (result === 'REDIRECT') await auth(provider, { serverUrl: MOBBIN_URL, authorizationCode: await code, scope: 'openid', fetchFn: boundedFetch });
      print('Mobbin connected.');
    } catch { throw new Error('Mobbin sign-in failed or timed out. Check your account plan and retry.'); }
    finally { process.off("SIGINT", interrupted); process.off("SIGTERM", interrupted); clearTimeout(timeout); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
}

export async function disconnectMobbin() {
  await withMobbinLock(async () => { await rm(join(mobbinDirectory(), 'credentials.json'), { force: true }); });
}
