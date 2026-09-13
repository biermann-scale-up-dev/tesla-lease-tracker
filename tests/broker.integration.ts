import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Kafka, logLevel } from 'kafkajs';
import Fastify from 'fastify';
import { TelemetryConsumer } from '../src/server/consumer.js';
import { reconstructTrips } from '../src/shared/analytics.js';
import { createStore, rawEvent, vin } from './fixtures.js';

test('real Redpanda -> consumer -> SQLite -> replay after consumer restart', { timeout: 60_000 }, async () => {
  const brokers = (process.env.KAFKA_BROKERS ?? '127.0.0.1:19092').split(',');
  const kafka = new Kafka({ clientId: 'lease-tracker-integration', brokers, logLevel: logLevel.ERROR });
  const admin = kafka.admin(); const producer = kafka.producer(); const { store, cleanup } = createStore(); const app = Fastify({ logger: false });
  let consumer: TelemetryConsumer | null = null;
  const group = `test-${randomUUID()}`;
  const until = async (count: number) => { for (let attempt = 0; attempt < 100; attempt++) { if (store.samples(vin).length >= count) return; await delay(100); } throw new Error(`Expected ${count} SQLite records; received ${store.samples(vin).length}`); };
  try {
    await admin.connect(); await admin.createTopics({ topics: [{ topic: 'tesla_V', numPartitions: 1, replicationFactor: 1 }, { topic: 'tesla_connectivity', numPartitions: 1, replicationFactor: 1 }] });
    await producer.connect();
    consumer = new TelemetryConsumer(brokers, store, app.log, group); await consumer.start();
    await producer.send({ topic: 'tesla_V', messages: ['P', 'D', 'P'].map((gear, index) => ({ key: vin, value: rawEvent(`2026-03-01T0${index + 7}:00:00Z`, gear as 'P' | 'D', index === 2 ? 1020 : 1000), headers: { vin } })) });
    await until(3); await consumer.stop(); consumer = null;
    await producer.send({ topic: 'tesla_V', messages: [{ key: vin, value: rawEvent('2026-03-01T09:00:00Z', 'P', 1020), headers: { vin } }, { key: vin, value: rawEvent('2026-03-01T10:00:00Z', 'D', 1020), headers: { vin } }, { key: vin, value: rawEvent('2026-03-01T11:00:00Z', 'P', 1030), headers: { vin } }] });
    consumer = new TelemetryConsumer(brokers, store, app.log, group); await consumer.start(); await until(5);
    const { trips } = reconstructTrips(store.samples(vin));
    assert.equal(trips.length, 2); assert.ok(Math.abs(trips.reduce((sum, trip) => sum + trip.distanceKm!, 0) - 30) < 0.00001);
    assert.equal(store.samples(vin).length, 5);
  } finally { await consumer?.stop(); await producer.disconnect(); await admin.disconnect(); await app.close(); cleanup(); }
});
