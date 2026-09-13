import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Store } from './store.js';
import type { TeslaStatus, Vehicle } from '../shared/types.js';
import { randomToken } from './security.js';

const tokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number().positive() });
const savedTokensSchema = z.object({ accessToken: z.string(), refreshToken: z.string(), expiresAt: z.number() });
const fleetStatusSchema = z.object({ response: z.object({ vehicle_info: z.record(z.string(), z.object({ firmware_version: z.string().nullable(), fleet_telemetry_version: z.string().nullable() })) }) });
const vehicleConfigSchema = z.object({ response: z.object({ key_paired: z.boolean().optional(), synced: z.boolean().optional(), limit_reached: z.boolean().optional(), config: z.object({ hostname: z.string(), port: z.number(), fields: z.record(z.string(), z.object({ interval_seconds: z.number().optional(), include_fields: z.array(z.string()).optional() })) }).nullable().optional() }) });
const vehiclesSchema = z.object({ response: z.array(z.object({ vin: z.string(), display_name: z.string().nullable().optional() })) });

export function supportsBoundaryTelemetry(version: string | null): boolean {
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [major, minor] = version.split('.').map(Number);
  return (major ?? 0) > 1 || (major === 1 && (minor ?? 0) >= 3);
}
export function telemetryConfiguration(hostname: string, port: number, ca: string) {
  return { hostname, port, ca, delivery_policy: 'latest', fields: { Gear: { interval_seconds: 1, include_fields: ['Odometer'] } } };
}
function safeResponse(text: string): string {
  return text.replace(/"(?:access_token|refresh_token|id_token|client_secret)"\s*:\s*"[^"]*"/g, '"secret":"[redacted]"').replace(/eyJ[A-Za-z0-9_.-]+/g, '[redacted]').slice(0, 500);
}
export class TeslaClient {
  private refreshInFlight: Promise<string> | null = null;
  private readonly shutdown = new AbortController();
  constructor(private readonly config: Config, private readonly store: Store, private readonly logger: FastifyBaseLogger) {}
  close(): void { this.shutdown.abort(); }
  private assertCredentials(): void { if (!this.config.clientId || !this.config.clientSecret) throw new Error('TESLA_CLIENT_ID und TESLA_CLIENT_SECRET fehlen in der Serverkonfiguration.'); }
  authorizationUrl(now: number, sessionToken: string): string {
    this.assertCredentials();
    const state = randomToken();
    this.store.addOAuthState(state, now, sessionToken);
    const url = new URL('https://auth.tesla.com/oauth2/v3/authorize');
    url.search = new URLSearchParams({ client_id: this.config.clientId, response_type: 'code', redirect_uri: `${this.config.origin}/api/tesla/callback`, scope: 'openid offline_access vehicle_device_data', state, nonce: randomToken(), locale: 'de-DE', require_requested_scopes: 'true', show_keypair_step: 'true' }).toString();
    return url.toString();
  }
  private async exchange(parameters: Record<string, string>): Promise<unknown> {
    this.assertCredentials();
    // Authorization codes and rotating refresh tokens must not be blindly replayed.
    const response = await fetch('https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token', { method: 'POST', body: new URLSearchParams({ client_id: this.config.clientId, ...parameters }), signal: AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(20_000)]) });
    const text = await response.text();
    if (!response.ok) throw new Error(`Tesla Token-Austausch fehlgeschlagen (${response.status}): ${safeResponse(text)}. Bei widerrufenem Zugriff Tesla erneut verbinden.`);
    return JSON.parse(text) as unknown;
  }
  private saveTokens(response: unknown, now: number): string {
    const tokens = tokenSchema.parse(response);
    this.store.transaction(() => {
      this.store.setSecret('teslaTokens', JSON.stringify({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: now + tokens.expires_in * 1000 }));
      this.store.setSetting('tesla', { ...this.store.teslaStatus(), connected: true, problem: null });
    });
    return tokens.access_token;
  }
  async completeAuthorization(code: string, state: string, now: number, sessionToken: string): Promise<void> {
    if (!this.store.consumeOAuthState(state, now, sessionToken)) throw new Error('OAuth-Anfrage abgelaufen, bereits verwendet oder gehört zu einer anderen Sitzung. Verbindung erneut starten.');
    this.saveTokens(await this.exchange({ grant_type: 'authorization_code', client_secret: this.config.clientSecret, code, redirect_uri: `${this.config.origin}/api/tesla/callback`, audience: this.config.fleetOrigin }), now);
  }
  async accessToken(): Promise<string> {
    const saved = this.store.secret('teslaTokens');
    if (!saved) throw new Error('Tesla-Konto ist noch nicht verbunden.');
    const tokens = savedTokensSchema.parse(JSON.parse(saved) as unknown);
    if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.exchange({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }).then(response => this.saveTokens(response, Date.now())).catch((error: unknown) => {
      if (!this.shutdown.signal.aborted) this.store.setSetting('tesla', { ...this.store.teslaStatus(), connected: false, problem: 'Autorisierung fehlgeschlagen. Tesla erneut verbinden.' });
      throw error;
    }).finally(() => { this.refreshInFlight = null; });
    return this.refreshInFlight;
  }
  private async request(path: string, method: 'GET' | 'POST' | 'DELETE', body: unknown, origin: string, token: string): Promise<unknown> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(`${origin}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === null ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(20_000)]) });
        const text = await response.text();
        if (response.ok) return JSON.parse(text) as unknown;
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          const retryAfter = Number(response.headers.get('retry-after'));
          if (retryAfter > 30) throw new Error(`Tesla begrenzt ${path}; erneut versuchen in ${retryAfter} Sekunden.`);
          this.logger.warn({ path, status: response.status, attempt: attempt + 1 }, 'Tesla-Anfrage wird erneut versucht');
          await delay(Math.max(500 * (attempt + 1), retryAfter * 1000), undefined, { signal: this.shutdown.signal });
          continue;
        }
        if (response.status === 401 || response.status === 403) this.store.setSetting('tesla', { ...this.store.teslaStatus(), connected: false, problem: 'Tesla-Zugriff abgelehnt. Berechtigungen prüfen und erneut verbinden.' });
        throw new Error(`Tesla ${method} ${path} fehlgeschlagen (${response.status}): ${safeResponse(text)}`);
      } catch (error) {
        if (!this.shutdown.signal.aborted && (error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError')) && attempt < 2) {
          this.logger.warn({ path, attempt: attempt + 1 }, 'Tesla-Netzwerkfehler; erneuter Versuch');
          await delay(500 * (attempt + 1), undefined, { signal: this.shutdown.signal }); continue;
        }
        throw error;
      }
    }
    throw new Error(`Tesla ${path}: Wiederholungen ausgeschöpft.`);
  }
  async registerPartner(): Promise<void> {
    const token = z.object({ access_token: z.string() }).parse(await this.exchange({ grant_type: 'client_credentials', client_secret: this.config.clientSecret, audience: this.config.fleetOrigin, scope: 'vehicle_device_data' }));
    await this.request('/api/1/partner_accounts', 'POST', { domain: new URL(this.config.origin).hostname }, this.config.fleetOrigin, token.access_token);
  }
  async vehicles(): Promise<Vehicle[]> {
    const response = vehiclesSchema.parse(await this.request('/api/1/vehicles', 'GET', null, this.config.fleetOrigin, await this.accessToken()));
    return response.response.flatMap(vehicle => {
      const model = vehicle.vin[3];
      return model === '3' || model === 'Y' ? [{ vin: vehicle.vin, name: vehicle.display_name || `Model ${model}`, model }] : [];
    });
  }
  async selectVehicle(vin: string): Promise<TeslaStatus> {
    const previous = this.store.teslaStatus();
    if (previous.vehicle && previous.vehicle.vin !== vin && this.store.samples(previous.vehicle.vin).length > 0) throw new Error('Diese Installation enthält bereits Fahrtdaten eines anderen Fahrzeugs. Für ein anderes Fahrzeug eine eigene Installation verwenden.');
    const vehicle = (await this.vehicles()).find(candidate => candidate.vin === vin);
    if (!vehicle) throw new Error('Model 3/Y wurde im autorisierten Tesla-Konto nicht gefunden.');
    this.store.setSetting('tesla', { ...previous, vehicle, configured: false, synced: false });
    return this.checkStatus();
  }
  async checkStatus(): Promise<TeslaStatus> {
    const previous = this.store.teslaStatus();
    if (!previous.vehicle) throw new Error('Zuerst ein Fahrzeug auswählen.');
    const token = await this.accessToken();
    const vin = previous.vehicle.vin;
    const status = fleetStatusSchema.parse(await this.request('/api/1/vehicles/fleet_status', 'POST', { vins: [vin] }, this.config.fleetOrigin, token));
    const info = status.response.vehicle_info[vin];
    if (!info) throw new Error('Tesla Fleet Status enthält keine Angaben zum ausgewählten Fahrzeug.');
    const config = vehicleConfigSchema.parse(await this.request(`/api/1/vehicles/${vin}/fleet_telemetry_config`, 'GET', null, this.config.fleetOrigin, token)).response;
    const fields = config.config?.fields;
    const configured = config.config?.hostname === this.config.telemetryHost && config.config?.port === this.config.telemetryPort && fields?.Gear?.interval_seconds === 1 && fields.Gear.include_fields?.length === 1 && fields.Gear.include_fields[0] === 'Odometer' && Object.keys(fields).length === 1;
    const next: TeslaStatus = { ...previous, connected: true, firmware: info.firmware_version, telemetryVersion: info.fleet_telemetry_version, keyPaired: config.key_paired === true, configured, synced: configured && config.synced === true, checkedAt: new Date().toISOString(), problem: !supportsBoundaryTelemetry(info.fleet_telemetry_version) ? 'Fleet Telemetry 1.3.0 oder neuer erforderlich. Fahrzeugsoftware aktualisieren.' : !config.key_paired ? 'Virtuellen Schlüssel in der Tesla-App hinzufügen.' : config.limit_reached ? 'Maximale Anzahl an Telemetrie-Konfigurationen erreicht.' : null };
    this.store.setSetting('tesla', next);
    return next;
  }
  pairingUrl(): string { return `https://tesla.com/_ak/${new URL(this.config.origin).hostname}`; }
  async configure(): Promise<TeslaStatus> {
    const status = await this.checkStatus();
    if (status.problem || !status.vehicle) throw new Error(status.problem ?? 'Fahrzeug fehlt.');
    if (!this.config.proxyOrigin || !this.config.telemetryHost || !this.config.telemetryCaPath) throw new Error('Command Proxy, Telemetrie-Hostname oder CA-Datei fehlt in der Serverkonfiguration.');
    const ca = readFileSync(this.config.telemetryCaPath, 'utf8');
    const result = z.object({ response: z.object({ updated_vehicles: z.number() }) }).parse(await this.request('/api/1/vehicles/fleet_telemetry_config', 'POST', { vins: [status.vehicle.vin], config: telemetryConfiguration(this.config.telemetryHost, this.config.telemetryPort, ca) }, this.config.proxyOrigin, await this.accessToken()));
    if (result.response.updated_vehicles !== 1) throw new Error('Tesla hat die Telemetrie-Konfiguration nicht übernommen. Fleet-Status und Schlüsselkopplung prüfen.');
    return this.checkStatus();
  }
  async disconnect(): Promise<void> {
    const status = this.store.teslaStatus();
    if (status.vehicle && this.store.secret('teslaTokens')) await this.request(`/api/1/vehicles/${status.vehicle.vin}/fleet_telemetry_config`, 'DELETE', null, this.config.fleetOrigin, await this.accessToken());
    this.store.transaction(() => { this.store.deleteSecret('teslaTokens'); this.store.setSetting('tesla', { ...status, connected: false, configured: false, synced: false, problem: 'Tesla-Verbindung wurde getrennt.' }); });
  }
}
