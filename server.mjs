import express from 'express';
import cron from 'node-cron';
import pg from 'pg';
import webpush from 'web-push';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { defaultSchedule } from './schedule-data.js';
import { AVATAR_IMAGE_URL } from './avatar-config.js';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 4173);
const distRoot = resolve(fileURLToPath(new URL('./dist', import.meta.url)));
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false } }) : null;
const memorySubscriptions = new Map();
let appIconBuffer;
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidEmail = process.env.VAPID_EMAIL || 'mailto:admin@example.com';
const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
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

const fallbackMessages = {
  morning: (date, schedule) => `Chào buổi sáng Vy yêu 🌷 Hôm nay ${date} ${schedule}. Chúc em một ngày thật vui vẻ, chuyên nghiệp và luôn giữ nụ cười nha 💗`,
  noon: (_date, schedule) => `Chúc em yêu buổi trưa thật vui ☀️ Hôm nay ${schedule}. Nhớ uống nước, ăn uống đầy đủ và nghỉ một chút khi có thể nha 💕`,
  evening: (date, schedule) => `Tối rồi, Vy yêu nhớ nghỉ ngơi nhé 🌙 Ngày mai ${date} ${schedule}. Ngủ ngon để mai luôn tràn đầy năng lượng nha 💞`
};

const notificationTitles = {
  morning: '🌷 Chào buổi sáng, Vy yêu',
  noon: '☀️ Chúc em yêu buổi trưa vui vẻ',
  evening: '🌙 Chúc em yêu buổi tối thật dịu dàng'
};

function fallbackMessage(moment, dateText, description) {
  return fallbackMessages[moment](dateText, description);
}

async function generateCuteMessage(moment, dateText, description) {
  const fallback = fallbackMessage(moment, dateText, description);
  if (!geminiApiKey) return fallback;

  const prompt = [
    'Viết một lời nhắn thông báo rất ngắn bằng tiếng Việt cho Phan Thị Thảo Vy, người yêu của người gửi.',
    `Thời điểm: ${moment === 'morning' ? 'buổi sáng' : moment === 'noon' ? 'buổi trưa' : 'buổi tối'}.`,
    `Lịch: ${moment === 'evening' ? `ngày mai ${dateText}` : `hôm nay ${dateText}`} ${description}.`,
    'Giọng điệu: cute, ấm áp, tự nhiên, có thể gọi Vy là em yêu, nhưng vẫn lịch sự và chuyên nghiệp.',
    'Có thể dùng 1–2 emoji. Chỉ trả về đúng một câu, không tiêu đề, không dấu ngoặc kép, tối đa 180 ký tự.'
  ].join(' ');

  // Chỉ gửi yêu cầu tạo câu chúc chung lên Gemini; lịch và ca làm được ghép cục bộ.
  const safePrompt = [
    'Write one short Vietnamese greeting for a loved one.',
    `Time of day: ${moment === 'morning' ? 'morning' : moment === 'noon' ? 'noon' : 'evening'}.`,
    'Make it cute, warm, natural, professional, and optionally use one or two emojis.',
    'Return only one sentence, without a title or quotation marks, under 180 characters.'
  ].join(' ');

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: safePrompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 100 }
      })
    });
    if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
    if (!text) throw new Error('Gemini không trả về nội dung');
    return text.replace(/^['"“”]+|['"“”]+$/g, '').replace(/\s+/g, ' ').slice(0, 180);
  } catch (error) {
    console.error('Gemini không tạo được lời nhắn mới:', error.message);
    return fallback;
  }
}

async function dispatchDailyReminder(moment) {
  if (!pushConfigured) return;
  const today = vietnamDateKey();
  const dateKey = moment === 'evening' ? addDays(today, 1) : today;
  const code = defaultSchedule[dateKey];
  const description = shiftDescription(code) || 'chưa có dữ liệu lịch';
  const dateText = prettyDate(dateKey);
  const greeting = await generateCuteMessage(moment, dateText, description);
  const scheduleText = moment === 'evening' ? `Ngày mai ${dateText} ${description}.` : `Hôm nay ${dateText} ${description}.`;
  const body = `${greeting} ${scheduleText}`;
  const payload = JSON.stringify({
    title: notificationTitles[moment],
    body,
    tag: `lich-${moment}-${dateKey}`,
    url: '/'
  });
  await sendToAllSubscriptions(payload);
}

app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (_request, response) => response.json({ ok: true, pushConfigured, database: Boolean(pool), geminiConfigured: Boolean(geminiApiKey) }));

app.get('/api/app-icon', async (_request, response) => {
  if (!/^https:\/\//i.test(AVATAR_IMAGE_URL)) {
    return response.status(404).send('Chưa cấu hình ảnh đại diện.');
  }
  try {
    if (!appIconBuffer) {
      const imageResponse = await fetch(AVATAR_IMAGE_URL, {
        headers: { 'user-agent': 'LichVy/1.0 image fetcher' }
      });
      if (!imageResponse.ok) throw new Error(`Ảnh trả về HTTP ${imageResponse.status}`);
      const source = Buffer.from(await imageResponse.arrayBuffer());
      appIconBuffer = await sharp(source)
        .resize(1024, 1024, { fit: 'contain', background: '#ffe4ec' })
        .jpeg({ quality: 92 })
        .toBuffer();
    }
    return response.type('image/jpeg').set('Cache-Control', 'public, max-age=3600').send(appIconBuffer);
  } catch (error) {
    console.error('Không tạo được icon từ ảnh Vy:', error.message);
    return response.status(502).send('Không tải được ảnh đại diện.');
  }
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
      body: 'Từ giờ Vy sẽ nhận lời nhắn dễ thương lúc 06:00, 12:00 và 20:00 mỗi ngày.',
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

cron.schedule('0 6 * * *', () => dispatchDailyReminder('morning'), { timezone: 'Asia/Ho_Chi_Minh' });
cron.schedule('0 12 * * *', () => dispatchDailyReminder('noon'), { timezone: 'Asia/Ho_Chi_Minh' });
cron.schedule('0 20 * * *', () => dispatchDailyReminder('evening'), { timezone: 'Asia/Ho_Chi_Minh' });

app.listen(port, '0.0.0.0', () => {
  console.log(`Lịch của Vy đang chạy tại cổng ${port}. Push: ${pushConfigured ? 'đã cấu hình' : 'chưa cấu hình'}.`);
  if (!pool) console.warn('DATABASE_URL chưa có: đăng ký nhận nhắc sẽ mất khi Railway restart.');
});
