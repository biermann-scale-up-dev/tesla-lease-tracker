import { existsSync } from 'node:fs';
import { readConfig } from '../src/server/config.js';
import { Store } from '../src/server/store.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const config = readConfig(process.env);
const destination = process.argv[2];
if (!destination) throw new Error('Usage: npm run backup -- backups/tracker-YYYY-MM-DD.sqlite');
const store = new Store(config.databasePath, config.encryptionKey);
try { await store.backup(destination); console.info(`Consistent SQLite backup created: ${destination}`); } finally { store.close(); }
