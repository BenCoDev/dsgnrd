import type { Context } from 'hono';
import { prototypePreview, previewCSP, readPrototype, revisionSchema } from '../integrations/prototype';
import { validatePrototypeAgent } from '../tools/prototype';

export function prototypePreviewPage(c: Context) {
  try {
    const experiment = Number(c.req.param('id')), author = Number(c.req.param('author'));
    if (![experiment, author].every(id => Number.isSafeInteger(id) && id > 0)) return c.notFound();
    const revision = revisionSchema.parse(c.req.param('revision'));
    validatePrototypeAgent(experiment, author);
    const prototype = readPrototype(experiment, author, revision);
    c.header('Content-Security-Policy', previewCSP);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    return c.html(prototypePreview(prototype));
  } catch { return c.notFound(); }
}
