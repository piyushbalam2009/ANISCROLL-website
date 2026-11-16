import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const standaloneDir = path.join(rootDir, '.next', 'standalone');
const standaloneServer = path.join(standaloneDir, 'server.js');
const sourceStaticDir = path.join(rootDir, '.next', 'static');
const targetStaticDir = path.join(standaloneDir, '.next', 'static');
const sourcePublicDir = path.join(rootDir, 'public');
const targetPublicDir = path.join(standaloneDir, 'public');

if (!fs.existsSync(standaloneServer)) {
  console.error(
    '[AniScroll] Standalone server not found at .next/standalone/server.js. Run "npm run build" first.'
  );
  process.exit(1);
}

function syncDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

try {
  syncDir(sourceStaticDir, targetStaticDir);
  syncDir(sourcePublicDir, targetPublicDir);
} catch (err) {
  console.warn('[AniScroll] Warning while syncing standalone assets:', err);
}

if (!process.env.HOSTNAME) {
  process.env.HOSTNAME = '0.0.0.0';
}
if (!process.env.PORT) {
  process.env.PORT = '3000';
}

process.chdir(standaloneDir);
await import(pathToFileURL(standaloneServer).href);
