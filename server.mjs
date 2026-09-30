import express from 'express';
import cron from 'node-cron';
import pg from 'pg';
import webpush from 'web-push';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultSchedule } from './schedule-data.js';
import { AVATAR_IMAGE_URL } from './avatar-config.js';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 4173);
const distRoot = resolve(fileURLToPath(new URL('./dist', import.meta.url)));
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false } }) : null;
const memorySubscriptions = new Map();
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidEmail = process.env.VAPID_EMAIL || 'mailto:admin@example.com';
let pushConfigured = false;

if (vapidPublicKey && vapidPrivateKey) {
  try {
    webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);
    pushConfigured = true;
  } catch (error) {
    console.error('VAPID configuration error:', error.message);
  }
}

const databaseReady = pool
  ? pool.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      subscription JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  : Promise.resolve();

function vietnamDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(key, amount) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return date.toISOString().slice(0, 10);
}

function shiftDescription(code) {
  if (code === 'D') return 'đi làm ca D, 07:30–19:30';
  if (code === 'N') return 'đi làm ca N, 19:30–07:30 hôm sau';
  if (code === '18' || code === '9') return 'được nghỉ';
  if (code === 'eAD') return 'có lịch điều chỉnh eAD';
  return null;
}

function prettyDate(key) {
  const [, month, day] = key.split('-');
  return `${day}/${month}`;
}

async function saveSubscription(subscription) {
  if (pool) {
    await databaseReady;
    await pool.query(
      `INSERT INTO push_subscriptions (endpoint, subscription)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (endpoint) DO UPDATE SET subscription = EXCLUDED.subscription, created_at = NOW()`,
      [subscription.endpoint, JSON.stringify(subscription)]
    );
    return;
  }
  memorySubscriptions.set(subscription.endpoint, subscription);
}

async function allSubscriptions() {
  if (pool) {
    await databaseReady;
    const result = await pool.query('SELECT subscription FROM push_subscriptions');
    return result.rows.map((row) => row.subscription);
  }
  return [...memorySubscriptions.values()];
}

async function removeSubscription(endpoint) {
  if (pool) {
    await databaseReady;
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
    return;
  }
  memorySubscriptions.delete(endpoint);
}

async function sendToAllSubscriptions(payload) {
  if (!pushConfigured) return;
  const subscriptions = await allSubscriptions();
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification(subscription, payload);
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) await removeSubscription(subscription.endpoint);
      else console.error('Không gửi được nhắc lịch:', error.message);
    }
  }));
}

async function dispatchReminder(kind) {
  if (!pushConfigured) return;
  const today = vietnamDateKey();
  const dateKey = kind === 'tomorrow' ? addDays(today, 1) : today;
  const code = defaultSchedule[dateKey];
  const description = shiftDescription(code);
  if (!description) return;

  const isTomorrow = kind === 'tomorrow';
  const payload = JSON.stringify({
    title: isTomorrow ? 'Lịch ngày mai của Vy 💌' : 'Lịch hôm nay của Vy 🌷',
    body: `Vy ơi, ${isTomorrow ? 'ngày mai' : 'hôm nay'} ${prettyDate(dateKey)} ${description}. Cố lên nha 💗`,
    tag: `lich-${kind}-${dateKey}`,
    url: '/'
  });
  await sendToAllSubscriptions(payload);
}

app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (_request, response) => response.json({ ok: true, pushConfigured, database: Boolean(pool) }));

app.get('/api/app-icon', (_request, response) => {
  if (!/^https:\/\//i.test(AVATAR_IMAGE_URL)) {
    return response.status(404).send('Chưa cấu hình ảnh đại diện.');
  }
  return response.redirect(AVATAR_IMAGE_URL);
});

app.get('/api/push/public-key', (_request, response) => {
  if (!pushConfigured) return response.status(503).json({ error: 'Push notifications are not configured.' });
  return response.json({ publicKey: vapidPublicKey });
});

app.post('/api/push/subscribe', async (request, response) => {
  const subscription = request.body;
  if (!pushConfigured) return response.status(503).json({ error: 'Push notifications are not configured.' });
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return response.status(400).json({ error: 'Invalid push subscription.' });
  }
  try {
    await saveSubscription(subscription);
    await webpush.sendNotification(subscription, JSON.stringify({
      title: 'Đã bật nhắc lịch cho Vy 🌷',
      body: 'Từ giờ Vy sẽ nhận lịch hôm nay lúc 06:00 và lịch ngày mai lúc 17:00.',
      tag: 'lich-cua-vy-welcome',
      url: '/'
    }));
    return response.status(201).json({ ok: true });
  } catch (error) {
    console.error('Không lưu được đăng ký thông báo:', error.message);
    return response.status(500).json({ error: 'Could not save subscription.' });
  }
});

app.use(express.static(distRoot, { etag: false, maxAge: 0 }));
app.use((request, response) => {
  if (request.method !== 'GET') return response.status(404).json({ error: 'Not found.' });
  return response.sendFile(resolve(distRoot, 'index.html'));
});

cron.schedule('0 6 * * *', () => dispatchReminder('today'), { timezone: 'Asia/Ho_Chi_Minh' });
cron.schedule('0 17 * * *', () => dispatchReminder('tomorrow'), { timezone: 'Asia/Ho_Chi_Minh' });

app.listen(port, '0.0.0.0', () => {
  console.log(`Lịch của Vy đang chạy tại cổng ${port}. Push: ${pushConfigured ? 'đã cấu hình' : 'chưa cấu hình'}.`);
  if (!pool) console.warn('DATABASE_URL chưa có: đăng ký nhận nhắc sẽ mất khi Railway restart.');
});
