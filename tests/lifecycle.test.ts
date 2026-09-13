import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, symlinkSync, appendFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { hashPassword } from '../src/server/security.js';
import { testKey, testPassword } from './fixtures.js';

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function until(condition: () => boolean, description: string, output: () => string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (condition()) return;
    await delay(50);
  }
  throw new Error(`${description}\n${output()}`);
}

function alive(child: ChildProcess): boolean { return child.exitCode === null && child.signalCode === null; }

test('native Node watcher restarts, recovers after a signalled child exit, and stops on SIGINT', { timeout: 25_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lease-tracker-watch-'));
  const port = await availablePort();
  cpSync(resolve('src'), join(directory, 'src'), { recursive: true });
  symlinkSync(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
  const child = spawn(process.execPath, ['--watch', '--watch-preserve-output', '--import', 'tsx', 'src/server/index.ts'], {
    cwd: directory,
    env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), APP_ORIGIN: `http://127.0.0.1:${port}`, APP_PASSWORD_HASH: hashPassword(testPassword), ENCRYPTION_KEY: testKey, DATABASE_PATH: join(directory, 'tracker.sqlite'), KAFKA_BROKERS: '', TESLA_CLIENT_ID: '', TESLA_CLIENT_SECRET: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout!.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr!.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  const pids = () => [...new Set([...output.matchAll(/"pid":(\d+).*Server listening/g)].map(match => Number(match[1])))];
  try {
    await until(() => pids().length === 1, 'Initial server did not start', () => output);
    appendFileSync(join(directory, 'src/server/config.ts'), '\n// restart regression\n');
    await until(() => pids().length === 2, 'File change did not restart the server', () => output);
    // tsx watch previously waited forever for a second exit event when exitCode was null
    // but signalCode was already populated. Exercise that exact lifecycle on Node watch.
    process.kill(pids().at(-1)!, 'SIGKILL');
    await delay(300);
    appendFileSync(join(directory, 'src/server/config.ts'), '\n// recover after signalled exit\n');
    await until(() => pids().length === 3, 'Watcher did not recover from a signalled child exit', () => output);
    child.kill('SIGINT');
    await until(() => !alive(child), 'SIGINT did not stop the watcher', () => output);
    assert.doesNotMatch(output, /MaxListenersExceededWarning|Force killing|Shutdown nach vier Sekunden/);
    for (const pid of pids()) assert.throws(() => process.kill(pid, 0));
  } finally {
    if (alive(child)) child.kill('SIGKILL');
    for (const pid of pids()) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already stopped. */ } }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SIGTERM during broker connection attempts has a bounded shutdown', { timeout: 15_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lease-tracker-stop-'));
  const port = await availablePort();
  const unavailableBrokerPort = await availablePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), APP_ORIGIN: `http://127.0.0.1:${port}`, APP_PASSWORD_HASH: hashPassword(testPassword), ENCRYPTION_KEY: testKey, DATABASE_PATH: join(directory, 'tracker.sqlite'), KAFKA_BROKERS: `127.0.0.1:${unavailableBrokerPort}`, TESLA_CLIENT_ID: '', TESLA_CLIENT_SECRET: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout!.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr!.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  try {
    await until(() => output.includes('Server listening'), 'Server did not start', () => output);
    child.kill('SIGTERM');
    await until(() => !alive(child), 'Broker startup prevented shutdown', () => output);
    assert.doesNotMatch(output, /MaxListenersExceededWarning/);
  } finally { if (alive(child)) child.kill('SIGKILL'); rmSync(directory, { recursive: true, force: true }); }
});
