import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const testing = process.argv.includes('--test');
const authTesting = process.argv.includes('--auth');
if (authTesting && !testing) throw new Error('--auth is supported only with --test and a disposable database');
const temp = testing ? await mkdtemp(join(tmpdir(), 'forget-me-not-tests-')) : undefined;
const backendPort = testing ? '3002' : process.env.FMN_PORT ?? '3001';
const frontendPort = testing ? '5174' : process.env.FMN_FRONTEND_PORT ?? '5173';
const env = {
  ...process.env,
  FMN_AUTH_MODE: testing ? (authTesting ? 'password' : 'local') : process.env.FMN_AUTH_MODE ?? 'password',
  FMN_PORT: backendPort,
  FMN_FRONTEND_PORT: frontendPort,
  ...(temp ? { FMN_DB_PATH: join(temp, 'test.sqlite') } : {}),
  VITE_API_TARGET: `http://127.0.0.1:${backendPort}`,
};
const children = [];
let stopping = false;
function start(command, args) {
  const child = spawn(command, args, { env, stdio: 'inherit', detached: true });
  children.push(child);
  child.on('error', (error) => { console.error(error.message); void stop(1); });
  child.on('exit', (code) => { if (!stopping) void stop(code ?? 1); });
  return child;
}
function signal(child, signal) {
  if (child.pid) { try { process.kill(-child.pid, signal); } catch { /* Already stopped. */ } }
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  const exits = children.filter((child) => child.exitCode === null && child.signalCode === null)
    .map((child) => new Promise((resolve) => child.once('exit', resolve)));
  children.forEach((child) => signal(child, 'SIGINT'));
  const force = setTimeout(() => children.forEach((child) => signal(child, 'SIGKILL')), 5000);
  await Promise.all(exits);
  clearTimeout(force);
  if (temp) await rm(temp, { recursive: true, force: true });
  process.exit(code);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

// Refuse occupied ports instead of accidentally connecting this UI to another database.
async function checkPort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(Number(port), '127.0.0.1', () => server.close(resolve));
  });
}
try { await checkPort(backendPort); await checkPort(frontendPort); }
catch (error) { console.error(`Local port unavailable: ${error.message}`); await stop(1); }

if (authTesting) {
  const { spawnSync } = await import('node:child_process');
  const bootstrap = spawnSync(process.env.CARGO ?? 'cargo', ['run', '--locked', '--manifest-path', 'backend/Cargo.toml', '--', '--bootstrap-local-admin', 'owner', '--password-stdin'], { env, input: 'Synthetic password for browser tests!\n', encoding: 'utf8' });
  if (bootstrap.status !== 0) { console.error('Test administrator bootstrap failed:', bootstrap.stderr); await stop(1); }
}
start(process.env.CARGO ?? 'cargo', ['run', '--locked', '--manifest-path', 'backend/Cargo.toml']);
let ready = false;
for (let attempt = 0; attempt < 240 && !stopping; attempt++) {
  try {
    const response = await fetch(`http://127.0.0.1:${backendPort}/api/health`, { signal: AbortSignal.timeout(1000) });
    if (response.ok) { ready = true; break; }
  } catch { /* Wait for compilation and migration. */ }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!ready) { console.error('Backend did not become ready.'); await stop(1); }
start(process.execPath, ['frontend/node_modules/vite/bin/vite.js', 'frontend', '--host', '127.0.0.1', '--port', frontendPort, '--strictPort']);
