const major = Number(process.versions.node.split('.')[0]);
if (major !== 24) {
  console.error(`Tesla Lease Tracker requires Node.js 24 LTS; this shell is using ${process.version}. Run "nvm install && nvm use" in this repository (or select Node 24 using your runtime manager), then run "npm ci" and "npm run dev" again.`);
  process.exitCode = 1;
}
