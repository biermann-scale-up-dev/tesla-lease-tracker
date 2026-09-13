import { existsSync } from 'node:fs';
import { readConfig } from '../src/server/config.js';
import { Store } from '../src/server/store.js';
import { seedDemo } from '../src/server/demo-data.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const config = readConfig(process.env);
const store = new Store(config.databasePath, config.encryptionKey);
try { seedDemo(store, new Date().toISOString()); console.info('Synthetic demo data created. No Tesla API calls were made.'); }
finally { store.close(); }
