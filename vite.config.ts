import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:3000' } },
  build: { rolldownOptions: { output: { codeSplitting: { groups: [
    { name: 'charts', test: /node_modules\/(recharts|d3-|victory|@reduxjs|react-redux|redux|reselect)/ },
    { name: 'calendar', test: /node_modules\/(@js-temporal|jsbi)/ },
    { name: 'react', test: /node_modules\/(react|react-dom|scheduler)\// },
  ] } } } },
});
