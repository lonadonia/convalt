#!/usr/bin/env node
/**
 * Runs one command against a temporary server and stops the server when the command ends — no
 * long-lived background server.
 *
 *   node scripts/serve.mjs node scripts/capture.mjs checks          production preview (dist/, :4173)
 *   node scripts/serve.mjs --dev node scripts/dc-lab-shots.mjs       dev server (:5173, dev pages)
 */
import { spawn } from 'node:child_process';
import { createServer, preview } from 'vite';

const argv = process.argv.slice(2);
const dev = argv[0] === '--dev';
const [cmd, ...args] = dev ? argv.slice(1) : argv;
if (!cmd) { console.error('usage: node scripts/serve.mjs [--dev] <command> [args…]'); process.exit(2); }
let close;
if (dev) {
  const server = await createServer({ logLevel: 'error', server: { port: 5173, strictPort: true } });
  await server.listen();
  close = () => server.close();
} else {
  const server = await preview({ logLevel: 'error', preview: { port: 4173, strictPort: true } });
  close = () => server.close();
}
const child = spawn(cmd, args, { stdio: 'inherit' });
const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c ?? 1)));
await close();
process.exit(code);
