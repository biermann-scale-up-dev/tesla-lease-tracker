import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const forbiddenPath = /(^|\/)(\.env(\..*)?|secrets|certs|backups|data)(\/|$)|\.(sqlite|db|key|p12)(-|$|\.)/;
const patterns = [
  /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{30,}\b/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
];
const problems = [];
for (const file of files) {
  if (forbiddenPath.test(file) && file !== '.env.example') problems.push(`${file}: private runtime path`);
  if (/\.(png|jpg|woff2?)$/.test(file)) continue;
  const content = readFileSync(file, 'utf8');
  if (patterns.some(pattern => pattern.test(content))) problems.push(`${file}: possible secret`);
}
const revisions = execFileSync('git', ['rev-list', '--all'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
for (const revision of revisions) {
  const patch = execFileSync('git', ['show', '--format=', '--no-ext-diff', revision], { encoding: 'utf8', maxBuffer: 30_000_000 });
  if (patterns.some(pattern => pattern.test(patch))) problems.push(`${revision}: possible secret in history`);
}
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
else console.info(`Secret preflight passed: ${files.length} tracked files and ${revisions.length} commits checked. Also review staged changes manually.`);
