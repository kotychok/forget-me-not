// Synthetic data only. All resources have random names and are removed on exit.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const image = process.env.IMAGE ?? 'forget-me-not:local';
const name = `fmn-test-${randomUUID()}`;
const volume = `${name}-data`;
const network = `${name}-network`;
const password = 'Synthetic container smoke password!';
const env = ['-e', 'FMN_PUBLIC_ORIGIN=https://fmn.test'];
function docker(args, input, allowFailure = false) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60_000 });
  if (result.error || (result.status !== 0 && !allowFailure)) {
    throw new Error(`${args[0]} failed: ${result.error?.message ?? result.stderr}`);
  }
  return result;
}
function check(condition, message) { if (!condition) throw new Error(message); }
function maintenance(args, input) {
  return docker(['run', '--rm', '-i', '-v', `${volume}:/data`, ...env, image, ...args], input).stdout;
}
function request(path, options = []) {
  return docker(['exec', name, 'curl', '--fail', '--silent', '--max-time', '5', '-H', 'Host: fmn.test', ...options, `http://127.0.0.1:3001${path}`]).stdout;
}
try {
  docker(['volume', 'create', volume]);
  docker(['network', 'create', network]);
  const invalid = docker(['run', '--rm', '-e', 'FMN_AUTH_MODE=local', image], undefined, true);
  check(invalid.status !== 0, 'Production accepted local bypass');
  maintenance(['--bootstrap-local-admin', 'smoke', '--password-stdin'], `${password}\n`);
  docker(['run', '-d', '--name', name, '--network', network, '--network-alias', 'smoke-app', '-v', `${volume}:/data`, ...env, image]);
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = docker(['exec', name, 'curl', '--fail', '--silent', '--max-time', '1', '-H', 'Host: fmn.test', 'http://127.0.0.1:3001/api/health'], undefined, true);
    if (response.status === 0) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  check(JSON.parse(request('/api/health')).mode === 'password', 'Password health check failed');
  check(request('/').includes('<html'), 'Built frontend not served');
  const proxied = docker(['run', '--rm', '--network', network, '--entrypoint', 'curl', image, '--fail', '--silent', '--max-time', '5', '-H', 'Host: fmn.test', 'http://smoke-app:3001/api/health']);
  check(JSON.parse(proxied.stdout).mode === 'password', 'Container listener is unreachable from a peer');
  check(docker(['exec', name, 'id', '-u']).stdout.trim() === '10001', 'Runtime user is root');
  const login = request('/api/auth/login', ['-i', '-H', 'Origin: https://fmn.test', '-H', 'X-FMN-Request: 1', '-H', 'Content-Type: application/json', '--data-binary', JSON.stringify({ login: 'smoke', password })]);
  const cookie = login.match(/set-cookie: (__Host-fmn\.sid=[^;\r\n]+);[^\r\n]*/i);
  check(cookie && /secure/i.test(cookie[0]) && /httponly/i.test(cookie[0]), 'Secure cookie missing');
  request('/api/lists', ['-H', `Cookie: ${cookie[1]}`, '-H', 'Origin: https://fmn.test', '-H', 'X-FMN-Request: 1', '-H', 'Content-Type: application/json', '--data-binary', '{"title":"Container persistence test"}']);
  docker(['restart', name]);
  let lists;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { lists = JSON.parse(request('/api/lists', ['-H', `Cookie: ${cookie[1]}`])); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  check(lists?.some(list => list.title === 'Container persistence test'), 'Data/session did not survive restart');
  maintenance(['--backup', '/data/pre-upgrade.sqlite']);
  maintenance(['--verify-backup', '/data/pre-upgrade.sqlite']);
  docker(['run', '--rm', '-e', 'FMN_DB_PATH=/data/restored.sqlite', '-v', `${volume}:/data`, image, '--restore-backup', '/data/pre-upgrade.sqlite']);
  maintenance(['--verify-backup', '/data/restored.sqlite']);
  console.log('Container checks passed: non-root, production guards, assets, login, restart persistence, backup/restore.');
} finally {
  docker(['rm', '-f', name], undefined, true);
  docker(['volume', 'rm', volume], undefined, true);
  docker(['network', 'rm', network], undefined, true);
}
