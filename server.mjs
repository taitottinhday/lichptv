import express from 'express';
import cron from 'node-cron';
import pg from 'pg';
import webpush from 'web-push';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { AccessToken, LiveKitAPI } from 'livekit-server-sdk';
import { defaultSchedule } from './schedule-data.js';
import { AVATAR_IMAGE_URL } from './avatar-config.js';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 4173);
const distRoot = resolve(fileURLToPath(new URL('./dist', import.meta.url)));
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false } }) : null;
const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/$/, '');
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();
const supabaseConfigured = Boolean(supabaseUrl && supabaseServiceKey);
const livekitRawUrl = process.env.LIVEKIT_URL?.trim();
const livekitUrl = livekitRawUrl?.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
const livekitHttpUrl = livekitUrl?.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://');
const livekitApiKey = process.env.LIVEKIT_API_KEY?.trim();
const livekitApiSecret = process.env.LIVEKIT_API_SECRET?.trim();
const livekitConfigured = Boolean(livekitUrl && livekitApiKey && livekitApiSecret);
const livekitRoomName = 'lich-cua-vy-private';
const memorySubscriptions = new Map();
let appIconBuffer;
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidEmail = process.env.VAPID_EMAIL || 'mailto:admin@example.com';
const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const adminUsername = process.env.ADMIN_USERNAME || 'anh';
const adminPassword = process.env.ADMIN_PASSWORD || '261004';
const adminSessions = new Set();
const memoryFoodRequests = [];
let memoryFoodRequestId = 0;
const memoryChatMessages = [];
let memoryChatMessageId = 0;
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
      role TEXT NOT NULL DEFAULT 'vy',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    ); ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'vy';
    CREATE TABLE IF NOT EXISTS food_requests (
      id BIGSERIAL PRIMARY KEY,
      category TEXT NOT NULL,
      item TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      response TEXT NOT NULL DEFAULT '',
      responded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    ); ALTER TABLE food_requests ADD COLUMN IF NOT EXISTS response TEXT NOT NULL DEFAULT ''; ALTER TABLE food_requests ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS chat_messages (
      id BIGSERIAL PRIMARY KEY,
      sender_role TEXT NOT NULL CHECK (sender_role IN ('vy', 'admin')),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`)
  : Promise.resolve();

async function supabaseRequest(path, options = {}) {
  if (!supabaseConfigured) throw new Error('Supabase chưa được cấu hình.');
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      Accept: 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const detail = typeof data === 'string' ? data : data?.message || data?.hint || data?.error;
    throw new Error(`Supabase HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return data;
}

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

async function saveSubscription(subscription, role = 'vy') {
  if (pool) {
    await databaseReady;
    await pool.query(
      `INSERT INTO push_subscriptions (endpoint, subscription, role)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (endpoint) DO UPDATE SET subscription = EXCLUDED.subscription, role = EXCLUDED.role, created_at = NOW()`,
      [subscription.endpoint, JSON.stringify(subscription), role]
    );
    return;
  }
  memorySubscriptions.set(subscription.endpoint, { subscription, role });
}

async function allSubscriptions(role = 'vy') {
  if (pool) {
    await databaseReady;
    const result = await pool.query('SELECT subscription FROM push_subscriptions WHERE role = $1', [role]);
    return result.rows.map((row) => row.subscription);
  }
  return [...memorySubscriptions.values()].filter((entry) => entry.role === role).map((entry) => entry.subscription);
}

async function removeSubscription(endpoint) {
  if (pool) {
    await databaseReady;
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
    return;
  }
  memorySubscriptions.delete(endpoint);
}

async function sendToRole(role, payload) {
  if (!pushConfigured) return;
  const subscriptions = await allSubscriptions(role);
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification(subscription, payload);
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) await removeSubscription(subscription.endpoint);
      else console.error('Không gửi được nhắc lịch:', error.message);
    }
  }));
}

function isAdminRequest(request) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  return Boolean(token && adminSessions.has(token));
}

const fallbackMessages = {
  morning: (date, schedule) => `Chào buổi sáng Vy yêu 🌷 Hôm nay ${date} ${schedule}. Chúc em một ngày thật ngọt ngào, vui vẻ và luôn nhớ anh iu nha 💗`,
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
    'Giọng điệu: ngọt ngào, lãng mạn, cute, ấm áp, tự nhiên, như lời nhắn của người yêu dành cho em yêu.',
    'Có thể dùng 1–2 emoji. Chỉ trả về đúng một câu, không tiêu đề, không dấu ngoặc kép, tối đa 180 ký tự.'
  ].join(' ');

  // Chỉ gửi yêu cầu tạo câu chúc chung lên Gemini; lịch và ca làm được ghép cục bộ.
  const safePrompt = [
    'Write one short Vietnamese greeting for a loved one.',
    `Time of day: ${moment === 'morning' ? 'morning' : moment === 'noon' ? 'noon' : 'evening'}.`,
    'Make it romantic, sweet, cute, warm, natural, and optionally use one or two emojis.',
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
  await sendToRole('vy', payload);
}

app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (_request, response) => response.json({ ok: true, pushConfigured, database: Boolean(pool), supabaseConfigured, livekitConfigured, geminiConfigured: Boolean(geminiApiKey) }));

app.post('/api/admin/login', (request, response) => {
  const { username, password } = request.body || {};
  if (username !== adminUsername || password !== adminPassword) {
    return response.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu.' });
  }
  const token = randomUUID();
  adminSessions.add(token);
  return response.json({ ok: true, token });
});

app.post('/api/livekit/token', async (request, response) => {
  const role = request.body?.role === 'admin' ? 'admin' : 'vy';
  if (role === 'admin' && !isAdminRequest(request)) {
    return response.status(401).json({ error: 'Cần đăng nhập góc của anh trước khi gọi.' });
  }
  if (!livekitConfigured) {
    return response.status(503).json({ error: 'LiveKit chưa được cấu hình trên Railway.' });
  }
  try {
    const displayName = role === 'admin' ? 'Anh' : 'Vy';
    const accessToken = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity: role === 'admin' ? 'anh' : 'vy',
      name: displayName,
      ttl: '2h'
    });
    accessToken.addGrant({
      roomJoin: true,
      room: livekitRoomName,
      canPublish: true,
      canSubscribe: true
    });
    const participantToken = await accessToken.toJwt();
    if (request.body?.announce !== false) {
      const recipientRole = role === 'admin' ? 'vy' : 'admin';
      await sendToRole(recipientRole, JSON.stringify({
        title: role === 'admin' ? '📹 Anh đang gọi video cho Vy' : '📹 Vy đang gọi video cho anh',
        body: 'Mở Lịch của Vy rồi bấm “Tham gia video” nha 💗',
        tag: `video-call-${Date.now()}`,
        url: role === 'admin' ? '/?call=1' : '/?admin=1&call=1'
      }));
    }
    return response.json({ serverUrl: livekitUrl, participantToken, roomName: livekitRoomName });
  } catch (error) {
    console.error('Không tạo được token LiveKit:', error.message);
    return response.status(500).json({ error: 'Chưa tạo được phòng gọi video.' });
  }
});

app.get('/api/livekit/check', async (request, response) => {
  if (!isAdminRequest(request)) return response.status(401).json({ error: 'Cần đăng nhập góc của anh.' });
  if (!livekitConfigured) return response.status(503).json({ ok: false, error: 'LiveKit chưa được cấu hình.' });
  try {
    const livekitApi = new LiveKitAPI({ host: livekitHttpUrl, apiKey: livekitApiKey, secret: livekitApiSecret });
    const rooms = await livekitApi.room.listRooms();
    return response.json({ ok: true, roomCount: rooms.length });
  } catch (error) {
    console.error('Kiểm tra LiveKit thất bại:', error.message);
    return response.status(502).json({ ok: false, error: 'LIVEKIT_URL, LIVEKIT_API_KEY và LIVEKIT_API_SECRET chưa cùng một project.' });
  }
});

app.get('/api/chat/messages', async (request, response) => {
  const viewerRole = request.query.role === 'admin' ? 'admin' : 'vy';
  if (viewerRole === 'admin' && !isAdminRequest(request)) {
    return response.status(401).json({ error: 'Cần đăng nhập góc chat của anh.' });
  }
  try {
    if (supabaseConfigured) {
      const rows = await supabaseRequest('chat_messages?select=id,sender_role,content,created_at&order=id.desc&limit=100');
      return response.json({ messages: (rows || []).reverse() });
    }
    if (pool) {
      await databaseReady;
      const result = await pool.query(
        `SELECT id, sender_role, content, created_at
         FROM chat_messages
         ORDER BY id DESC
         LIMIT 100`
      );
      return response.json({ messages: result.rows.reverse() });
    }
    return response.json({ messages: memoryChatMessages.slice(-100) });
  } catch (error) {
    console.error('Không đọc được lịch sử chat:', error.message);
    return response.status(500).json({ error: 'Chưa tải được lịch sử tin nhắn.' });
  }
});

app.post('/api/chat/messages', async (request, response) => {
  const senderRole = request.body?.senderRole === 'admin' ? 'admin' : 'vy';
  if (senderRole === 'admin' && !isAdminRequest(request)) {
    return response.status(401).json({ error: 'Cần đăng nhập góc chat của anh.' });
  }
  const content = String(request.body?.content || '').trim().slice(0, 2000);
  if (!content) return response.status(400).json({ error: 'Tin nhắn chưa có nội dung.' });

  try {
    let message;
    if (supabaseConfigured) {
      const rows = await supabaseRequest('chat_messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify({ sender_role: senderRole, content })
      });
      message = rows?.[0];
    } else if (pool) {
      await databaseReady;
      const result = await pool.query(
        `INSERT INTO chat_messages (sender_role, content)
         VALUES ($1, $2)
         RETURNING id, sender_role, content, created_at`,
        [senderRole, content]
      );
      message = result.rows[0];
    } else {
      message = {
        id: ++memoryChatMessageId,
        sender_role: senderRole,
        content,
        created_at: new Date().toISOString()
      };
      memoryChatMessages.push(message);
      if (memoryChatMessages.length > 100) memoryChatMessages.shift();
    }

    const recipientRole = senderRole === 'vy' ? 'admin' : 'vy';
    const senderName = senderRole === 'vy' ? 'Vy' : 'Anh';
    await sendToRole(recipientRole, JSON.stringify({
      title: senderRole === 'vy' ? '💌 Vy vừa nhắn cho anh' : '💌 Anh vừa nhắn cho Vy',
      body: `${senderName}: ${content.slice(0, 180)}`,
      tag: `chat-message-${message.id}`,
      url: senderRole === 'vy' ? '/?admin=1' : '/'
    }));
    return response.status(201).json({ ok: true, message });
  } catch (error) {
    console.error('Không gửi được tin nhắn:', error.message);
    return response.status(500).json({ error: 'Chưa gửi được tin nhắn.' });
  }
});

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
  const role = request.body?.role === 'admin' ? 'admin' : 'vy';
  const subscription = request.body?.subscription || request.body;
  if (role === 'admin' && !isAdminRequest(request)) {
    return response.status(401).json({ error: 'Cần đăng nhập tài khoản nhận request.' });
  }
  if (!pushConfigured) return response.status(503).json({ error: 'Push notifications are not configured.' });
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return response.status(400).json({ error: 'Invalid push subscription.' });
  }
  try {
    await saveSubscription(subscription, role);
    await webpush.sendNotification(subscription, JSON.stringify({
      title: role === 'admin' ? 'Đã bật nhận request món ăn 💌' : 'Đã bật nhắc lịch cho Vy 🌷',
      body: role === 'admin' ? 'Từ giờ anh sẽ nhận được thông báo khi Vy chọn món.' : 'Từ giờ Vy sẽ nhận lời nhắn dễ thương lúc 06:00, 12:00 và 20:00 mỗi ngày.',
      tag: role === 'admin' ? 'food-request-admin-welcome' : 'lich-cua-vy-welcome',
      url: '/'
    }));
    return response.status(201).json({ ok: true });
  } catch (error) {
    console.error('Không lưu được đăng ký thông báo:', error.message);
    return response.status(500).json({ error: 'Could not save subscription.' });
  }
});

app.post('/api/food-requests', async (request, response) => {
  const category = String(request.body?.category || '').trim().slice(0, 80);
  const item = String(request.body?.item || '').trim().slice(0, 160);
  const note = String(request.body?.note || '').trim().slice(0, 500);
  if (!category || !item) return response.status(400).json({ error: 'Vui lòng chọn món hoặc ghi chú món.' });

  try {
    let requestRecord;
    if (pool) {
      await databaseReady;
      const result = await pool.query(
        `INSERT INTO food_requests (category, item, note) VALUES ($1, $2, $3)
         RETURNING id, category, item, note, status, created_at`,
        [category, item, note]
      );
      requestRecord = result.rows[0];
    } else {
      requestRecord = { id: ++memoryFoodRequestId, category, item, note, status: 'pending', response: '', responded_at: null, created_at: new Date().toISOString() };
      memoryFoodRequests.unshift(requestRecord);
    }
    await sendToRole('admin', JSON.stringify({
      title: '💌 Vy chọn món rồi nè',
      body: `${item}${note ? ` · Ghi chú: ${note}` : ''}. Anh mua cho em nha 💗`,
      tag: `food-request-${requestRecord.id}`,
      url: '/?admin=1'
    }));
    return response.status(201).json({ ok: true, request: requestRecord });
  } catch (error) {
    console.error('Không lưu được request món ăn:', error.message);
    return response.status(500).json({ error: 'Chưa gửi được request món ăn.' });
  }
});

app.get('/api/food-requests', async (request, response) => {
  if (!isAdminRequest(request)) return response.status(401).json({ error: 'Chưa đăng nhập tài khoản nhận request.' });
  try {
    if (pool) {
      await databaseReady;
      const result = await pool.query('SELECT id, category, item, note, status, response, responded_at, created_at FROM food_requests ORDER BY created_at DESC LIMIT 50');
      return response.json({ requests: result.rows });
    }
    return response.json({ requests: memoryFoodRequests.slice(0, 50) });
  } catch (error) {
    console.error('Không đọc được request món ăn:', error.message);
    return response.status(500).json({ error: 'Chưa đọc được request món ăn.' });
  }
});

app.patch('/api/food-requests/:id', async (request, response) => {
  if (!isAdminRequest(request)) return response.status(401).json({ error: 'Chưa đăng nhập tài khoản nhận request.' });
  const status = ['pending', 'bought', 'done'].includes(request.body?.status) ? request.body.status : null;
  if (!status) return response.status(400).json({ error: 'Trạng thái không hợp lệ.' });
  try {
    if (pool) {
      await databaseReady;
      await pool.query('UPDATE food_requests SET status = $1 WHERE id = $2', [status, request.params.id]);
    } else {
      const record = memoryFoodRequests.find((entry) => String(entry.id) === String(request.params.id));
      if (record) record.status = status;
    }
    return response.json({ ok: true });
  } catch (error) {
    console.error('Không cập nhật được request món ăn:', error.message);
    return response.status(500).json({ error: 'Chưa cập nhật được request.' });
  }
});

app.post('/api/food-requests/:id/respond', async (request, response) => {
  if (!isAdminRequest(request)) return response.status(401).json({ error: 'Chưa đăng nhập tài khoản nhận request.' });
  const responseText = String(request.body?.response || '').trim().slice(0, 500);
  const status = ['pending', 'bought', 'done'].includes(request.body?.status) ? request.body.status : 'pending';
  if (!responseText) return response.status(400).json({ error: 'Hãy nhập lời phản hồi cho Vy.' });
  try {
    let requestRecord;
    if (pool) {
      await databaseReady;
      const result = await pool.query(
        `UPDATE food_requests SET response = $1, responded_at = NOW(), status = $2
         WHERE id = $3
         RETURNING id, item, note`,
        [responseText, status, request.params.id]
      );
      requestRecord = result.rows[0];
    } else {
      requestRecord = memoryFoodRequests.find((entry) => String(entry.id) === String(request.params.id));
      if (requestRecord) {
        requestRecord.response = responseText;
        requestRecord.responded_at = new Date().toISOString();
        requestRecord.status = status;
      }
    }
    if (!requestRecord) return response.status(404).json({ error: 'Không tìm thấy request món ăn.' });
    await sendToRole('vy', JSON.stringify({
      title: '💌 Anh phản hồi món của Vy',
      body: `${responseText} · Món em chọn: ${requestRecord.item} 💗`,
      tag: `food-response-${requestRecord.id}-${Date.now()}`,
      url: '/'
    }));
    return response.json({ ok: true });
  } catch (error) {
    console.error('Không gửi được phản hồi món ăn:', error.message);
    return response.status(500).json({ error: 'Chưa gửi được phản hồi cho Vy.' });
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
