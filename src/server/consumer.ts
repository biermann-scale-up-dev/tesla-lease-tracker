import { Kafka, logLevel } from 'kafkajs';
import type { Consumer, IHeaders } from 'kafkajs';
import type { FastifyBaseLogger } from 'fastify';
import type { Store } from './store.js';
import { ingestRecord } from './telemetry.js';
import type { ServiceStatus } from '../shared/types.js';
import { z } from 'zod';

export function messageHeaders(headers: IHeaders | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(headers ?? {}).flatMap(([key, value]) => typeof value === 'string' || Buffer.isBuffer(value) ? [[key, value.toString()]] : []));
}
export class TelemetryConsumer {
  private readonly consumer: Consumer;
  private state: ServiceStatus['broker'] = 'connecting';
  private problem: string | null = null;
  constructor(brokers: string[], private readonly store: Store, private readonly logger: FastifyBaseLogger, groupId: string) {
    const kafka = new Kafka({ clientId: 'tesla-lease-tracker', brokers, logLevel: logLevel.WARN, retry: { retries: 8 }, logCreator: () => ({ log }) => { this.logger.warn({ message: log.message }, 'Kafka'); } });
    this.consumer = kafka.consumer({ groupId, sessionTimeout: 30_000, allowAutoTopicCreation: false });
    this.consumer.on(this.consumer.events.GROUP_JOIN, () => { this.state = 'connected'; this.problem = null; });
    this.consumer.on(this.consumer.events.DISCONNECT, () => { this.state = 'error'; this.problem = 'Broker-Verbindung unterbrochen.'; });
    this.consumer.on(this.consumer.events.CRASH, event => { this.state = 'error'; this.problem = 'Telemetrie-Verarbeitung fehlgeschlagen. Serverprotokoll prüfen.'; this.logger.error({ err: event.payload.error }, 'Consumer abgestürzt'); });
  }
  async start(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topics: ['tesla_V', 'tesla_connectivity'], fromBeginning: true });
    await this.consumer.run({ autoCommit: false, eachMessage: async ({ topic, partition, message }) => {
      if (message.value === null) throw new Error(`Leerer Kafka-Datensatz: ${topic}/${partition}/${message.offset}`);
      const result = ingestRecord(this.store, { topic, raw: message.value.toString('utf8'), headers: messageHeaders(message.headers), receivedAt: new Date().toISOString() });
      if (result === 'rejected') this.logger.warn({ topic, partition, offset: message.offset }, 'Ungültiger Telemetrie-Datensatz isoliert; Statusanzeige prüfen');
      // Persist first. A crash before the offset commit is safe because inserts are idempotent.
      await this.consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
    } });
  }
  status(): ServiceStatus { return serviceStatus(this.store, this.state, this.problem); }
  async stop(): Promise<void> { await this.consumer.disconnect(); }
}
export function serviceStatus(store: Store, broker: ServiceStatus['broker'], problem: string | null): ServiceStatus {
  const connection = store.setting('connectivity');
  const last = store.setting('lastMessageAt');
  return { broker, receiver: 'unchecked', problem, lastMessageAt: last === null ? null : z.string().parse(last), vehicleConnectivity: connection === null ? null : z.object({ status: z.string() }).parse(connection).status, rejectedRecords: store.rejectedCount() };
}
