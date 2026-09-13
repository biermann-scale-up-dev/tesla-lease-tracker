import { existsSync } from 'node:fs';
import { readConfig } from './config.js';
import { Store } from './store.js';
import { buildApp } from './app.js';
import { TelemetryConsumer, serviceStatus } from './consumer.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const config = readConfig(process.env);
const store = new Store(config.databasePath, config.encryptionKey);
let consumer: TelemetryConsumer | null = null;
const { app, tesla } = await buildApp(config, store, () => consumer ? consumer.status() : serviceStatus(store, 'disabled', 'KAFKA_BROKERS ist nicht konfiguriert.'));
await app.listen({ host: config.host, port: config.port });
if (config.brokers.length > 0) {
  consumer = new TelemetryConsumer(config.brokers, store, app.log, 'tesla-lease-tracker');
  consumer.start().catch((error: unknown) => { app.log.fatal({ err: error }, 'Telemetrie-Start fehlgeschlagen'); void shutdown(1); });
}
const refresh = setInterval(() => {
  if (store.teslaStatus().connected) tesla.accessToken().catch((error: unknown) => app.log.error({ err: error }, 'Tesla-Autorisierung erfordert Aufmerksamkeit'));
}, 60 * 60 * 1000);
const statusCheck = setInterval(() => {
  if (store.teslaStatus().connected && store.teslaStatus().vehicle) tesla.checkStatus().catch((error: unknown) => app.log.error({ err: error }, 'Tesla-Konfiguration konnte nicht überprüft werden'));
}, 24 * 60 * 60 * 1000);
let stopping = false;
async function shutdown(code: number): Promise<void> {
  if (stopping) return;
  stopping = true; clearInterval(refresh); clearInterval(statusCheck);
  tesla.close();
  // A stalled external connection must not leave development restarts or Docker stops hanging.
  const deadline = setTimeout(() => {
    app.log.fatal('Shutdown nach vier Sekunden abgebrochen. Nicht bestätigte Kafka-Nachrichten werden beim Neustart erneut verarbeitet.');
    process.exit(1);
  }, 4000);
  deadline.unref();
  const results = await Promise.allSettled([consumer?.stop(), app.close()]);
  for (const result of results) if (result.status === 'rejected') { app.log.error({ err: result.reason }, 'Shutdown fehlgeschlagen'); process.exitCode = 1; }
  try { store.close(); } catch (error) { app.log.error({ err: error }, 'Datenbank konnte nicht geschlossen werden'); process.exitCode = 1; }
  clearTimeout(deadline);
  process.exitCode = process.exitCode ?? code;
}
process.on('SIGINT', () => { void shutdown(0); });
process.on('SIGTERM', () => { void shutdown(0); });
