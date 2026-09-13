import { existsSync, writeFileSync } from 'node:fs';
import { hashPassword, randomToken } from '../src/server/security.js';

if (existsSync('.env')) throw new Error('.env already exists. Edit it explicitly; setup never overwrites credentials.');
const password = process.env.SETUP_PASSWORD ?? randomToken().slice(0, 24);
const origin = new URL(process.env.SETUP_ORIGIN ?? 'http://127.0.0.1:3000').origin;
writeFileSync('.env', `NODE_ENV=development\nHOST=127.0.0.1\nPORT=3000\nAPP_ORIGIN=${origin}\nAPP_PASSWORD_HASH=${hashPassword(password)}\nENCRYPTION_KEY=${randomToken()}\nDATABASE_PATH=data/tracker.sqlite\n`, { mode: 0o600, flag: 'wx' });
console.info('Created .env. Keep it private and back up ENCRYPTION_KEY separately.');
if (!process.env.SETUP_PASSWORD) console.info(`Your generated app password (shown once): ${password}`);
