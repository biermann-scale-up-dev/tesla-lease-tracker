import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

export default defineConfig({
  plugins: [react(), { name: 'lease-offline-shell', closeBundle() {
    const assets = readdirSync('dist', { recursive: true }).map(String).filter(path => /\.(html|js|css|png|svg|webmanifest)$/.test(path) && path !== 'sw.js' && path !== 'lease-tracker.scriptable.js').sort();
    const revision = createHash('sha256');
    for (const path of assets) revision.update(path).update(readFileSync(`dist/${path}`));
    const worker = readFileSync('public/sw.js', 'utf8').replace('__REVISION__', revision.digest('hex').slice(0, 16)).replace("['__SHELL_ASSETS__']", JSON.stringify(assets.map(path => `/${path}`)));
    writeFileSync('dist/sw.js', worker);
  } }],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:3000' } },
  build: { rolldownOptions: { output: { codeSplitting: { groups: [
    { name: 'charts', test: /node_modules\/(recharts|d3-|victory|@reduxjs|react-redux|redux|reselect)/ },
    { name: 'calendar', test: /node_modules\/(@js-temporal|jsbi)/ },
    { name: 'react', test: /node_modules\/(react|react-dom|scheduler)\// },
  ] } } } },
});
