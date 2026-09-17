import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { deviceKindSchema, deviceSettingsSchema, forecastBasisSchema } from '../shared/types.js';
import type { PairedDevice } from '../shared/types.js';
import { summarize } from '../shared/analytics.js';
import { widgetSummary } from '../shared/widget.js';
import type { Store } from './store.js';
import type { Config } from './config.js';
import { digest, randomToken } from './security.js';

const deviceRow = z.object({ id: z.string(), kind: deviceKindSchema, name: z.string(), forecastBasis: forecastBasisSchema, createdAt: z.string(), lastUsedAt: z.string().nullable() });
const columns = 'id,kind,name,forecast_basis AS forecastBasis,created_at AS createdAt,last_used_at AS lastUsedAt';
const codeSchema = z.string().regex(/^[A-F0-9]{12}$/);
const pairingRow = z.object({ secret_hash: z.string().nullable(), kind: deviceKindSchema, name: z.string(), forecast_basis: forecastBasisSchema, approved: z.number() });
const failure = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

export function deviceToken(request: FastifyRequest): string | null {
  const bearer = request.headers.authorization;
  return bearer !== undefined ? (/^Bearer ([A-Za-z0-9_-]+)$/.exec(bearer)?.[1] ?? null) : request.cookies.widget_device ?? null;
}

export function registerDevices(app: FastifyInstance, store: Store, config: Config): void {
  const limits = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };
  app.get('/api/devices', async (): Promise<PairedDevice[]> => store.db.prepare(`SELECT ${columns} FROM devices ORDER BY created_at DESC`).all().map(row => deviceRow.parse(row)));
  app.put('/api/devices/:id', async request => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const settings = deviceSettingsSchema.parse(request.body);
    if (!store.db.prepare('UPDATE devices SET name=?,forecast_basis=? WHERE id=? RETURNING id').get(settings.name, settings.forecastBasis, id)) throw failure(404, 'Gerät nicht gefunden.');
    return { ok: true };
  });
  app.delete('/api/devices/:id', async request => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    store.db.prepare('DELETE FROM devices WHERE id=?').run(id);
    return { ok: true };
  });
  app.post('/api/pairing/scriptable', limits, async request => {
    const settings = deviceSettingsSchema.parse(request.body);
    const code = randomBytes(6).toString('hex').toUpperCase();
    const expiresAt = Date.now() + 600_000;
    store.db.prepare('DELETE FROM pairings WHERE expires_at<=?').run(Date.now());
    store.db.prepare('INSERT INTO pairings VALUES (?,?,?,?,?,?,?)').run(digest(code), null, 'scriptable', settings.name, settings.forecastBasis, 1, expiresAt);
    return { code, expiresAt };
  });
  app.post('/api/pairing/tesla', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async () => {
    const code = randomBytes(6).toString('hex').toUpperCase();
    const secret = randomToken();
    const expiresAt = Date.now() + 600_000;
    store.db.prepare('DELETE FROM pairings WHERE expires_at<=?').run(Date.now());
    store.db.prepare('INSERT INTO pairings VALUES (?,?,?,?,?,?,?)').run(digest(code), digest(secret), 'tesla', 'Tesla-Browser', 'window-1', 0, expiresAt);
    return { code, secret, expiresAt, approvalUrl: `${config.origin}/#settings?pair=${code}` };
  });
  app.post('/api/pairing/approve', limits, async request => {
    const { code, ...settings } = deviceSettingsSchema.extend({ code: codeSchema }).parse(request.body);
    const row = store.db.prepare("UPDATE pairings SET approved=1,name=?,forecast_basis=? WHERE code_hash=? AND kind='tesla' AND approved=0 AND expires_at>? RETURNING code_hash").get(settings.name, settings.forecastBasis, digest(code), Date.now());
    if (!row) throw failure(400, 'Kopplung abgelaufen oder bereits bestätigt. Im Tesla neu starten.');
    return { ok: true };
  });
  app.post('/api/pairing/claim', limits, async (request, reply) => {
    const input = z.object({ code: codeSchema, secret: z.string().min(32).max(256).optional() }).strict().parse(request.body);
    const result = store.transaction(() => {
      const value = store.db.prepare('SELECT * FROM pairings WHERE code_hash=? AND expires_at>?').get(digest(input.code), Date.now());
      if (!value) throw failure(400, 'Kopplungscode ungültig, abgelaufen oder bereits verwendet.');
      const pair = pairingRow.parse(value);
      if (pair.kind === 'tesla' && (!input.secret || digest(input.secret) !== pair.secret_hash)) throw failure(403, 'Browsernachweis der Kopplung fehlt.');
      if (!pair.approved) return null;
      const token = randomToken(); const id = randomToken();
      store.db.prepare('INSERT INTO devices VALUES (?,?,?,?,?,?,?)').run(id, digest(token), pair.kind, pair.name, pair.forecast_basis, new Date().toISOString(), null);
      store.db.prepare('DELETE FROM pairings WHERE code_hash=?').run(digest(input.code));
      return { token, kind: pair.kind };
    });
    if (!result) return reply.code(202).send({ pending: true });
    if (result.kind === 'tesla') {
      reply.setCookie('widget_device', result.token, { path: '/api/widget-summary', httpOnly: true, secure: config.production, sameSite: 'strict', maxAge: 365 * 86400 });
      return { pending: false };
    }
    return { pending: false, token: result.token };
  });
  app.get('/api/widget-summary', async (request, reply) => {
    const token = deviceToken(request);
    const value = token ? store.db.prepare(`SELECT ${columns} FROM devices WHERE hash=?`).get(digest(token)) : null;
    if (!value) {
      reply.clearCookie('widget_device', { path: '/api/widget-summary' });
      throw failure(401, 'Gerätezugriff fehlt oder wurde widerrufen. Bitte erneut koppeln.');
    }
    const device = deviceRow.parse(value);
    const at = new Date().toISOString();
    store.db.prepare('UPDATE devices SET last_used_at=? WHERE id=?').run(at, device.id);
    if (device.kind === 'tesla') reply.setCookie('widget_device', token!, { path: '/api/widget-summary', httpOnly: true, secure: config.production, sameSite: 'strict', maxAge: 365 * 86400 });
    const contract = store.contract(); const vehicle = store.teslaStatus().vehicle;
    const summary = contract ? summarize(contract, store.preferences(), vehicle ? store.samples(vehicle.vin) : [], at) : null;
    return widgetSummary(summary, contract, device.forecastBasis, store.setting('demo') === true, at);
  });
}
