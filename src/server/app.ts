import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { contractSchema, preferencesSchema } from '../shared/types.js';
import type { Dashboard, ServiceStatus } from '../shared/types.js';
import { summarize } from '../shared/analytics.js';
import type { Config } from './config.js';
import type { Store } from './store.js';
import { randomToken, verifyPassword } from './security.js';
import { TeslaClient } from './tesla.js';
import { receiverStatus } from './receiver-status.js';

function httpError(statusCode: number, message: string): Error & { statusCode: number } { return Object.assign(new Error(message), { statusCode }); }

export async function buildApp(config: Config, store: Store, service: () => ServiceStatus) {
  const app = Fastify({ logger: { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'] }, logController: new Fastify.LogController({ disableRequestLogging: true }), bodyLimit: 32_768, trustProxy: false });
  const tesla = new TeslaClient(config, store, app.log);
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"], upgradeInsecureRequests: config.production ? [] : null } } });
  await app.register(rateLimit, { global: false });
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== config.origin) throw httpError(403, 'Ungültiger Anfrage-Ursprung. App über APP_ORIGIN öffnen.');
    const path = request.url.split('?')[0];
    if (path === '/api/login' || path === '/api/session') return;
    const token = request.cookies.session;
    if (!token || !store.hasSession(token, Date.now())) throw httpError(401, 'Bitte anmelden.');
  });
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof z.ZodError ? 400 : typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 502;
    const message = error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') : error instanceof Error ? error.message : 'Unbekannter Serverfehler.';
    if (status >= 500) app.log.error({ message }, 'Anfrage fehlgeschlagen');
    reply.code(status).send({ error: message });
  });
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/api/session', async request => ({ authenticated: Boolean(request.cookies.session && store.hasSession(request.cookies.session, Date.now())) }));
  app.post('/api/login', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const { password } = z.object({ password: z.string().min(1).max(256) }).strict().parse(request.body);
    if (!verifyPassword(password, config.passwordHash)) throw httpError(401, 'Das Passwort stimmt nicht.');
    const token = randomToken(); store.addSession(token, Date.now());
    reply.setCookie('session', token, { path: '/', httpOnly: true, secure: config.production, sameSite: 'lax', maxAge: 7 * 86400 });
    return { ok: true };
  });
  app.post('/api/logout', async (request, reply) => { if (request.cookies.session) store.deleteSession(request.cookies.session); reply.clearCookie('session', { path: '/' }); return { ok: true }; });
  app.get('/api/dashboard', async (): Promise<Dashboard> => {
    const contract = store.contract();
    const preferences = store.preferences();
    const status = store.teslaStatus();
    return { contract, preferences, summary: contract ? summarize(contract, preferences, status.vehicle ? store.samples(status.vehicle.vin) : [], new Date().toISOString()) : null, tesla: status, service: { ...service(), receiver: await receiverStatus(config.telemetryStatusUrl) }, demo: store.setting('demo') === true };
  });
  app.put('/api/contract', async request => { const contract = contractSchema.parse(request.body); store.setSetting('contract', contract); return contract; });
  app.put('/api/preferences', async request => { const preferences = preferencesSchema.parse(request.body); store.setSetting('preferences', preferences); return preferences; });
  app.post('/api/tesla/authorize', async request => ({ url: tesla.authorizationUrl(Date.now(), request.cookies.session!) }));
  app.get('/api/tesla/callback', async (request, reply) => {
    const query = z.object({ code: z.string(), state: z.string() }).parse(request.query);
    await tesla.completeAuthorization(query.code, query.state, Date.now(), request.cookies.session!);
    return reply.redirect('/?connected=1#settings');
  });
  app.post('/api/tesla/register', async () => { await tesla.registerPartner(); return { ok: true }; });
  app.get('/api/tesla/vehicles', async () => ({ vehicles: await tesla.vehicles() }));
  app.put('/api/tesla/vehicle', async request => { const { vin } = z.object({ vin: z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/) }).strict().parse(request.body); return tesla.selectVehicle(vin); });
  app.post('/api/tesla/check', async () => tesla.checkStatus());
  app.get('/api/tesla/pairing', async () => ({ url: tesla.pairingUrl() }));
  app.post('/api/tesla/configure', async () => tesla.configure());
  app.post('/api/tesla/disconnect', async () => { await tesla.disconnect(); return { ok: true }; });
  app.get('/.well-known/appspecific/com.tesla.3p.public-key.pem', async (_request, reply) => {
    if (!config.publicKeyPath) throw httpError(404, 'Tesla public key is not configured.');
    const key = readFileSync(config.publicKeyPath, 'utf8');
    if (!key.startsWith('-----BEGIN PUBLIC KEY-----')) throw new Error('Öffentlicher Tesla-Schlüssel hat das falsche Format.');
    return reply.type('application/x-pem-file').send(key);
  });
  if (existsSync(resolve('dist'))) {
    await app.register(staticFiles, { root: resolve('dist'), cacheControl: false });
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: 'API-Endpunkt nicht gefunden.' }) : reply.sendFile('index.html'));
  }
  return { app, tesla };
}
