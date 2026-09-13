import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  HOST: z.string().optional(),
  APP_ORIGIN: z.string().url(),
  APP_PASSWORD_HASH: z.string().regex(/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/),
  ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/),
  DATABASE_PATH: z.string().min(1),
  KAFKA_BROKERS: z.string().optional(),
  TESLA_CLIENT_ID: z.string().optional(),
  TESLA_CLIENT_SECRET: z.string().optional(),
  TESLA_REGION: z.enum(['eu', 'na']).optional(),
  TESLA_PUBLIC_KEY_PATH: z.string().optional(),
  TESLA_COMMAND_PROXY_URL: z.string().url().optional(),
  TELEMETRY_HOST: z.string().optional(),
  TELEMETRY_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  TELEMETRY_CA_PATH: z.string().optional(),
  TELEMETRY_STATUS_URL: z.string().url().optional(),
});
export type Config = ReturnType<typeof readConfig>;
export function readConfig(env: NodeJS.ProcessEnv) {
  const value = environmentSchema.parse(env);
  const origin = new URL(value.APP_ORIGIN).origin;
  if (value.NODE_ENV === 'production' && !origin.startsWith('https://')) throw new Error('APP_ORIGIN muss im Produktionsbetrieb HTTPS verwenden.');
  return {
    origin, passwordHash: value.APP_PASSWORD_HASH, encryptionKey: value.ENCRYPTION_KEY, databasePath: value.DATABASE_PATH,
    host: value.HOST ?? '127.0.0.1', port: value.PORT ?? 3000, production: value.NODE_ENV === 'production',
    brokers: value.KAFKA_BROKERS ? value.KAFKA_BROKERS.split(',').map(part => part.trim()) : [],
    clientId: value.TESLA_CLIENT_ID ?? '', clientSecret: value.TESLA_CLIENT_SECRET ?? '',
    fleetOrigin: `https://fleet-api.prd.${value.TESLA_REGION ?? 'eu'}.vn.cloud.tesla.com`,
    publicKeyPath: value.TESLA_PUBLIC_KEY_PATH ?? '', proxyOrigin: value.TESLA_COMMAND_PROXY_URL ?? '',
    telemetryHost: value.TELEMETRY_HOST ?? '', telemetryPort: value.TELEMETRY_PORT ?? 8443, telemetryCaPath: value.TELEMETRY_CA_PATH ?? '', telemetryStatusUrl: value.TELEMETRY_STATUS_URL ?? '',
  };
}
