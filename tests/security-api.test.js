import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';

const port = 22000 + Math.floor(Math.random() * 20000);
const origin = `http://127.0.0.1:${port}`;
const credentials = {
  vy: { username: 'vy-test-user', password: 'vy-test-password-123' },
  admin: { username: 'admin-test-user', password: 'admin-test-password-123' }
};
const childEnv = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: String(port),
  DATABASE_URL: '',
  SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  VAPID_PUBLIC_KEY: '',
  VAPID_PRIVATE_KEY: '',
  VY_USERNAME: credentials.vy.username,
  VY_PASSWORD: credentials.vy.password,
  ADMIN_USERNAME: credentials.admin.username,
  ADMIN_PASSWORD: credentials.admin.password,
  ADMIN_SESSION_SECRET: 'unit-test-only-session-secret-0123456789'
};
let serverProcess;
let vyToken;
let adminToken;

async function waitForServer() {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) throw new Error(`Test server exited with ${serverProcess.exitCode}`);
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch { /* Wait for the local test server to bind. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start in time.');
}

async function waitForHealth(url, processRef) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (processRef.exitCode !== null) throw new Error(`Test server exited with ${processRef.exitCode}`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch { /* Wait for the local test server to bind. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start in time.');
}

async function request(path, { token, ...options } = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${origin}${path}`, { ...options, headers });
  return { response, data: await response.json().catch(() => ({})) };
}

before(async () => {
  serverProcess = spawn(process.execPath, ['server.mjs'], { cwd: process.cwd(), env: childEnv, stdio: ['ignore', 'ignore', 'pipe'] });
  let startupError = '';
  serverProcess.stderr.setEncoding('utf8').on('data', (chunk) => { startupError += chunk; });
  try {
    await waitForServer();
  } catch (error) {
    throw new Error(`${error.message}\n${startupError}`);
  }
});

after(() => {
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill();
});

test('private schedule, chat, food, call and push endpoints reject anonymous requests', async () => {
  const cases = [
    ['GET', '/api/schedule'],
    ['PUT', '/api/schedule', { schedule: { '2099-01-01': 'D' } }],
    ['GET', '/api/chat/messages?role=vy'],
    ['POST', '/api/chat/messages', { senderRole: 'vy', content: 'test only' }],
    ['POST', '/api/chat/messages/1/reaction', { role: 'vy', reaction: '💗' }],
    ['POST', '/api/food-requests', { category: 'test', item: 'test only' }],
    ['POST', '/api/push/subscribe', { role: 'vy', subscription: {} }],
    ['POST', '/api/livekit/token', { role: 'vy', announce: false }]
  ];
  for (const [method, path, body] of cases) {
    const { response } = await request(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, 401, `${method} ${path} should require a session`);
  }
});

test('server login issues distinct signed sessions and rejects invalid credentials', async () => {
  const bad = await request('/api/user/login', { method: 'POST', body: JSON.stringify({ username: credentials.vy.username, password: 'incorrect' }) });
  assert.equal(bad.response.status, 401);

  const vy = await request('/api/user/login', { method: 'POST', body: JSON.stringify(credentials.vy) });
  assert.equal(vy.response.status, 200);
  assert.equal(vy.data.role, 'vy');
  assert.equal(typeof vy.data.token, 'string');
  vyToken = vy.data.token;

  const admin = await request('/api/admin/login', { method: 'POST', body: JSON.stringify(credentials.admin) });
  assert.equal(admin.response.status, 200);
  assert.equal(admin.data.role, 'admin');
  adminToken = admin.data.token;
  assert.notEqual(adminToken, vyToken);
});

test('a signed role cannot impersonate the other role through query strings or payloads', async () => {
  const wrongScheduleView = await request('/api/schedule?role=admin', { token: vyToken });
  assert.equal(wrongScheduleView.response.status, 403);

  const wrongChatView = await request('/api/chat/messages?role=admin', { token: vyToken });
  assert.equal(wrongChatView.response.status, 403);

  const wrongSender = await request('/api/chat/messages', {
    method: 'POST', token: vyToken,
    body: JSON.stringify({ senderRole: 'admin', content: 'test only' })
  });
  assert.equal(wrongSender.response.status, 403);

  const wrongReaction = await request('/api/chat/messages/1/reaction', {
    method: 'POST', token: vyToken,
    body: JSON.stringify({ role: 'admin', reaction: '💗' })
  });
  assert.equal(wrongReaction.response.status, 403);

  const wrongFoodRole = await request('/api/food-requests', {
    method: 'POST', token: adminToken,
    body: JSON.stringify({ category: 'test', item: 'test only' })
  });
  assert.equal(wrongFoodRole.response.status, 403);
});

test('authorized users can read the schedule; an empty database is identified as volatile memory', async () => {
  const { response, data } = await request('/api/schedule', { token: vyToken });
  assert.equal(response.status, 200);
  assert.equal(data.storageMode, 'memory');
  assert.equal(data.hasStoredEntries, false);
  assert.ok(data.schedule && typeof data.schedule === 'object');
  assert.equal(data.schedule['2026-10-26'], undefined, 'days beyond the supplied schedule must stay unassigned');

  const addFutureShift = await request('/api/schedule', {
    method: 'PUT', token: vyToken,
    body: JSON.stringify({ schedule: { '2099-01-01': 'D' } })
  });
  assert.equal(addFutureShift.response.status, 200, 'authorized users can add dates beyond the old fixed range');
  const futureSchedule = await request('/api/schedule', { token: vyToken });
  assert.equal(futureSchedule.data.schedule['2099-01-01'], 'D');

  const adminView = await request('/api/schedule?role=admin', { token: adminToken });
  assert.equal(adminView.response.status, 200);
});

test('an unreachable configured PostgreSQL database returns an API error instead of default calendar data', async () => {
  const badDbPort = port + 1;
  const badDbOrigin = `http://127.0.0.1:${badDbPort}`;
  const badDbProcess = spawn(process.execPath, ['server.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, PORT: String(badDbPort), DATABASE_URL: 'postgres://test:test@127.0.0.1:1/does_not_exist' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  try {
    await waitForHealth(badDbOrigin, badDbProcess);
    const loginResponse = await fetch(`${badDbOrigin}/api/user/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials.vy)
    });
    const login = await loginResponse.json();
    const scheduleResponse = await fetch(`${badDbOrigin}/api/schedule`, { headers: { Authorization: `Bearer ${login.token}` } });
    const result = await scheduleResponse.json();
    assert.equal(scheduleResponse.status, 500);
    assert.equal(result.error, 'Chưa đọc được lịch của Vy.');
    assert.equal(result.schedule, undefined);
  } finally {
    if (badDbProcess.exitCode === null) badDbProcess.kill();
  }
});

test('production refuses to start when credentials or persistent storage are missing', () => {
  const runProductionStart = (overrides) => spawnSync(process.execPath, ['server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...childEnv,
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT: '',
      ...overrides
    },
    encoding: 'utf8',
    timeout: 10000
  });
  const missingAuth = runProductionStart({
    DATABASE_URL: '', ADMIN_USERNAME: '', ADMIN_PASSWORD: '', ADMIN_SESSION_SECRET: '', VY_USERNAME: '', VY_PASSWORD: ''
  });
  assert.notEqual(missingAuth.status, 0);
  assert.match(missingAuth.stderr, /Thiếu cấu hình xác thực production/);
  assert.match(missingAuth.stderr, /ADMIN_SESSION_SECRET/);

  const missingDatabase = runProductionStart({
    DATABASE_URL: '', ADMIN_USERNAME: credentials.admin.username, ADMIN_PASSWORD: credentials.admin.password,
    ADMIN_SESSION_SECRET: childEnv.ADMIN_SESSION_SECRET, VY_USERNAME: credentials.vy.username, VY_PASSWORD: credentials.vy.password
  });
  assert.notEqual(missingDatabase.status, 0);
  assert.match(missingDatabase.stderr, /DATABASE_URL/);
});
