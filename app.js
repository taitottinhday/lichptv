import { defaultSchedule } from './schedule-data.js';
import { AVATAR_IMAGE_URL } from './avatar-config.js';
import { LocalAudioTrack, LocalVideoTrack, Room, RoomEvent, Track, VideoPresets } from 'livekit-client';

const STORAGE_KEY = 'lich-cua-vy-schedule-v2';
const AUTH_KEY = 'lich-cua-vy-authenticated-v1';
const ADMIN_TOKEN_KEY = 'lich-cua-vy-admin-token-v1';
const ADMIN_PUSH_ENABLED_KEY = 'lich-cua-vy-admin-push-enabled-v1';
const CHAT_IMAGE_PREFIX = '__lich_chat_image__:';
const CHAT_CALL_PREFIX = '__lich_call__:';
const CALL_MEDIA_PREFS_KEY = 'lich-cua-vy-call-media-prefs-v1';
const CHAT_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const LOVE_START_DATE = new Date(2022, 10, 3, 0, 0, 0);
const FACE_LANDMARKER_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const FACE_LANDMARKER_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm';
const DEMO_USERNAME = 'phanthithaovy';
const DEMO_PASSWORD = '261004';
const START_DATE = '2026-09-26';
const END_DATE = '2026-10-25';

const FOOD_MENU = [
  { category: 'Nước uống', emoji: '🥤', items: ['Trà sữa truyền thống', 'Trà sữa cốm', 'Trà sữa khoai môn', 'Trà sữa matcha', 'Trà sữa socola', 'Trà sữa ô long', 'Trà đào cam sả', 'Trà vải', 'Trà dâu', 'Trà chanh', 'Nước sen dừa', 'Nước dừa tắc', 'Nước cam', 'Nước ép dưa hấu', 'Nước ép táo', 'Sữa tươi trân châu đường đen', 'Cacao đá', 'Matcha latte', 'Cà phê sữa', 'Nước suối'] },
  { category: 'Món ăn', emoji: '🍱', items: ['Cơm gà', 'Cơm tấm sườn bì chả', 'Cơm chiên dương châu', 'Phở bò', 'Phở gà', 'Bún bò Huế', 'Bún chả', 'Bún thịt nướng', 'Mì cay', 'Mì trộn', 'Mì xào bò', 'Bánh mì thịt', 'Bánh mì xíu mại', 'Bánh cuốn', 'Bánh xèo', 'Cháo gà', 'Gà rán', 'Gà sốt cay', 'Pizza', 'Sushi', 'Kimbap', 'Tokbokki', 'Salad', 'Hamburger'] },
  { category: 'Bánh & ăn vặt', emoji: '🍰', items: ['Bánh flan', 'Bánh su kem', 'Bánh tiramisu', 'Bánh bông lan trứng muối', 'Bánh crepe', 'Bánh mochi', 'Bánh cá', 'Bánh gạo cay', 'Bánh tráng trộn', 'Bánh tráng cuốn', 'Khoai tây chiên', 'Xúc xích', 'Cá viên chiên', 'Há cảo', 'Nem chua rán', 'Chè', 'Sữa chua dẻo', 'Kem'] }
];

const QUICK_RESPONSES = {
  now: { text: 'Anh sẽ mua cho em bây giờ nha 💗', status: 'bought' },
  later: { text: 'Để anh sắp xếp rồi mua cho em sau nha 💌', status: 'pending' },
  evening: { text: 'Tối đi làm về anh mua cho em nha 🌙', status: 'pending' }
};

const state = {
  schedule: loadSchedule(),
  visibleMonth: new Date(),
  selectedDate: null,
  selectedCode: null,
  selectedFoods: [],
  toastTimer: null,
  countdownTimer: null,
  chatTimer: null,
  chatLoading: false,
  loveCounterTimer: null,
  selectedMood: 'loved',
  adminVisibleMonth: new Date(),
  adminSchedule: { ...defaultSchedule }
};

let nativeNotificationsPromise;
let livekitRoom;
let activeCallRole;
let activeCallType = 'video';
let pendingIncomingCall = null;
let faceLandmarkerPromise;
let activeFilterPipeline;
let incomingAlertTimer;
let incomingAudioContext;
let incomingAlertRole;
const callUiStates = new Map();

const CALL_BACKGROUND_PRESETS = [
  { id: 'none', label: 'Gốc', emoji: '◌', background: 'transparent' },
  { id: 'sunset', label: 'Hoàng hôn', emoji: '🌅', background: 'linear-gradient(145deg, #ff9a9e, #fad0c4 52%, #fbc2eb)' },
  { id: 'ocean', label: 'Đại dương', emoji: '🌊', background: 'linear-gradient(145deg, #0f4c75, #3282b8 52%, #bbe1fa)' },
  { id: 'aurora', label: 'Cực quang', emoji: '🌌', background: 'linear-gradient(145deg, #141e30, #243b55 48%, #7f53ac)' },
  { id: 'hearts', label: 'Tim hồng', emoji: '💗', background: 'radial-gradient(circle at 20% 20%, #ffb6d9 0 4%, transparent 5%), radial-gradient(circle at 80% 35%, #ffd0e6 0 5%, transparent 6%), linear-gradient(145deg, #7f1d5a, #e83e8c)' },
  { id: 'lavender', label: 'Lavender', emoji: '🪻', background: 'linear-gradient(145deg, #654ea3, #eaafc8)' }
];

const CALL_COLOR_PRESETS = [
  { id: 'none', label: 'Gốc', emoji: '◌', filter: 'none' },
  { id: 'dreamy', label: 'Dreamy', emoji: '✨', filter: 'saturate(1.15) brightness(1.08) contrast(.94)' },
  { id: 'warm', label: 'Ấm áp', emoji: '☀️', filter: 'sepia(.18) saturate(1.22) brightness(1.04)' },
  { id: 'cool', label: 'Băng tuyết', emoji: '❄️', filter: 'hue-rotate(155deg) saturate(.86) brightness(1.08)' },
  { id: 'pink', label: 'Hồng xinh', emoji: '🌸', filter: 'hue-rotate(315deg) saturate(1.32) brightness(1.05)' },
  { id: 'mono', label: 'Đen trắng', emoji: '◐', filter: 'grayscale(1) contrast(1.08)' }
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
}

function getCallMediaPrefs(role) {
  try {
    const saved = JSON.parse(localStorage.getItem(`${CALL_MEDIA_PREFS_KEY}:${role}`));
    return { camera: saved?.camera !== false, microphone: saved?.microphone !== false };
  } catch {
    return { camera: true, microphone: true };
  }
}

function saveCallMediaPref(role, key, value) {
  const prefs = getCallMediaPrefs(role);
  prefs[key] = value;
  localStorage.setItem(`${CALL_MEDIA_PREFS_KEY}:${role}`, JSON.stringify(prefs));
}

function loveDuration(now = new Date()) {
  if (now < LOVE_START_DATE) return { years: 0, months: 0, days: 0, totalDays: 0 };
  let cursor = new Date(LOVE_START_DATE);
  let years = 0;
  let months = 0;
  while (new Date(cursor.getFullYear() + 1, cursor.getMonth(), cursor.getDate()) <= now) {
    cursor.setFullYear(cursor.getFullYear() + 1);
    years += 1;
  }
  while (new Date(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate()) <= now) {
    cursor.setMonth(cursor.getMonth() + 1);
    months += 1;
  }
  const days = Math.floor((now - cursor) / 86400000);
  const totalDays = Math.floor((now - LOVE_START_DATE) / 86400000);
  return { years, months, days, totalDays };
}

function nextLoveMilestone(now = new Date()) {
  const totalDays = loveDuration(now).totalDays;
  const options = [];
  [100, 365, 500, 1000, 1500, 2000].forEach((days) => {
    if (days > totalDays) options.push({ days, label: `${days} ngày yêu nhau` });
  });
  const anniversary = new Date(now.getFullYear(), 10, 3);
  if (anniversary <= now) anniversary.setFullYear(anniversary.getFullYear() + 1);
  options.push({ days: Math.ceil((anniversary - now) / 86400000), label: `kỷ niệm ${anniversary.getFullYear() - LOVE_START_DATE.getFullYear()} năm` });
  options.sort((a, b) => a.days - b.days);
  return options[0];
}

function renderLoveCounter() {
  const duration = loveDuration();
  const milestone = nextLoveMilestone();
  ['love', 'adminLove'].forEach((prefix) => {
    if (prefix === 'adminLove' && !$('#adminLoveTotalDaysBig')) {
      const main = $('#adminLoveCounter .love-counter-main');
      if (main) {
        const total = document.createElement('div');
        total.className = 'love-total-days';
        total.setAttribute('aria-live', 'polite');
        total.innerHTML = '<strong id="adminLoveTotalDaysBig">0</strong><span>ngày yêu nhau</span>';
        main.prepend(total);
      }
    }
    const set = (suffix, value) => { const element = $(`#${prefix}${suffix}`); if (element) element.textContent = value; };
    set('Years', duration.years);
    set('Months', duration.months);
    set('Days', duration.days);
    set('TotalDays', `${duration.totalDays} ngày`);
    set('TotalDaysBig', duration.totalDays);
    set('Milestone', `Còn ${milestone.days} ngày nữa tới ${milestone.label} ✨`);
  });
}

async function loadMood(role = 'vy') {
  if (role === 'admin') {
    const display = $('#adminMoodDisplay');
    if (display) display.textContent = 'Mood check-in được giữ riêng trên thiết bị của Vy.';
    return;
  }
  let localMood = null;
  try { localMood = JSON.parse(localStorage.getItem('lich-cua-vy-mood-v1') || 'null'); } catch { localStorage.removeItem('lich-cua-vy-mood-v1'); }
  if (localMood) {
    state.selectedMood = localMood.mood || state.selectedMood;
    $('#moodNote').value = localMood.note || '';
    $$('.mood-picker [data-mood]').forEach((button) => button.classList.toggle('active', button.dataset.mood === state.selectedMood));
    $('#moodStatus').textContent = `Đã lưu trên máy này: ${localMood.emoji || ''} ${localMood.label || ''}`;
  }
  return;
  const token = role === 'admin' ? localStorage.getItem(ADMIN_TOKEN_KEY) : '';
  if (role === 'admin' && !token) return;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  try {
    const response = await fetch(`/api/moods?role=${role}`, { headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Chưa tải được mood.');
    const mood = data.mood;
    if (role === 'admin') {
      const display = $('#adminMoodDisplay');
      if (display) display.innerHTML = mood ? `${escapeHtml(mood.emoji || '💗')} <b>${escapeHtml(mood.label || 'Mood của Vy')}</b>${mood.note ? ` · ${escapeHtml(mood.note)}` : ''}<small> · ${escapeHtml(mood.date_key || '')}</small>` : 'Chưa có check-in hôm nay của Vy.';
    } else if (mood) {
      state.selectedMood = mood.mood || state.selectedMood;
      $('#moodNote').value = mood.note || '';
      $$('.mood-picker [data-mood]').forEach((button) => button.classList.toggle('active', button.dataset.mood === state.selectedMood));
      $('#moodStatus').textContent = `Đã lưu: ${mood.emoji || ''} ${mood.label || ''}`;
    }
  } catch (error) {
    const target = role === 'admin' ? $('#adminMoodDisplay') : $('#moodStatus');
    if (target) target.textContent = error.message;
  }
}

async function saveMood() {
  const status = $('#moodStatus');
  const note = $('#moodNote').value.trim();
  const moodMeta = { happy: ['😊', 'Vui'], loved: ['🥰', 'Được yêu'], tired: ['😴', 'Hơi mệt'], sad: ['🥺', 'Buồn'], excited: ['✨', 'Háo hức'] }[state.selectedMood] || ['💗', 'Được yêu'];
  localStorage.setItem('lich-cua-vy-mood-v1', JSON.stringify({ mood: state.selectedMood, note, emoji: moodMeta[0], label: moodMeta[1], savedAt: new Date().toISOString() }));
  status.textContent = 'Đã lưu mood riêng trên thiết bị này 💗';
  return;
  try {
    const response = await fetch('/api/moods', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'vy', mood: state.selectedMood, note }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Chưa lưu được mood.');
    status.textContent = 'Anh đã nhận được mood của em rồi nha 💌';
  } catch (error) { status.textContent = error.message; }
}

function loadSchedule() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && typeof saved === 'object' ? { ...defaultSchedule, ...saved } : { ...defaultSchedule };
  } catch {
    return { ...defaultSchedule };
  }
}

function saveSchedule() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.schedule));
  syncScheduleToServer().catch(() => {
    showToast('Lịch đã lưu trên máy Vy, nhưng chưa đồng bộ được với máy anh.');
  });
}

async function syncScheduleToServer() {
  const response = await fetch('/api/schedule', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schedule: state.schedule })
  });
  if (!response.ok) throw new Error('Schedule sync failed');
}

function renderFoodMenu() {
  const container = $('#foodCategories');
  if (!container) return;
  container.innerHTML = FOOD_MENU.map((group) => `
    <div class="food-category">
      <h3>${group.emoji} ${group.category}</h3>
      <div class="food-options">
        ${group.items.map((item) => `<button class="food-option" type="button" data-food="${item}" data-category="${group.category}">${item}</button>`).join('')}
      </div>
    </div>
  `).join('');
  $$('.food-option').forEach((button) => button.addEventListener('click', () => {
    const selectedIndex = state.selectedFoods.findIndex((food) => food.item === button.dataset.food);
    if (selectedIndex >= 0) {
      state.selectedFoods.splice(selectedIndex, 1);
      button.classList.remove('selected');
    } else {
      state.selectedFoods.push({ item: button.dataset.food, category: button.dataset.category });
      button.classList.add('selected');
    }
    const selectedItems = state.selectedFoods.map((food) => food.item);
    $('#foodRequestStatus').textContent = selectedItems.length
      ? `Em đang chọn: ${selectedItems.join(', ')} 💗`
      : 'Em chưa chọn món nào, chọn món em thích nha 💕';
  }));
}

async function submitFoodRequest() {
  const note = $('#foodNote').value.trim();
  if (!state.selectedFoods.length && !note) {
    $('#foodRequestStatus').textContent = 'Em chọn một hoặc nhiều món, hoặc ghi chú món em thích trước nha 💕';
    return;
  }
  const button = $('#sendFoodRequest');
  button.disabled = true;
  try {
    const response = await fetch('/api/food-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: [...new Set(state.selectedFoods.map((food) => food.category))].join(' · ') || 'Món em ghi chú',
        item: state.selectedFoods.map((food) => food.item).join(', ') || 'Món theo ghi chú',
        note
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Chưa gửi được request món ăn.');
    $('#foodRequestStatus').textContent = 'Anh nhận được rồi nha, để anh đi mua cho em 💌';
    $('#foodNote').value = '';
    state.selectedFoods = [];
    $$('.food-option').forEach((item) => item.classList.remove('selected'));
    showToast('Đã gửi món em thích cho anh rồi 💗');
  } catch (error) {
    $('#foodRequestStatus').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function chatTime(createdAt) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('vi-VN', { timeZone: CHAT_TIME_ZONE, hour: '2-digit', minute: '2-digit' });
}

function chatDateKey(createdAt) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHAT_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function chatDateLabel(createdAt) {
  const key = chatDateKey(createdAt);
  if (!key) return 'Ngày không xác định';
  const todayKey = chatDateKey(new Date());
  if (key === todayKey) return 'Hôm nay';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === chatDateKey(yesterday)) return 'Hôm qua';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: CHAT_TIME_ZONE,
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).format(new Date(createdAt));
}

function parseChatMessage(content) {
  const raw = String(content ?? '');
  if (raw.startsWith(CHAT_CALL_PREFIX)) {
    try {
      const payload = JSON.parse(raw.slice(CHAT_CALL_PREFIX.length));
      return { type: 'call', ...payload };
    } catch {
      return { type: 'text', text: raw };
    }
  }
  if (!raw.startsWith(CHAT_IMAGE_PREFIX)) return { type: 'text', text: raw };
  try {
    const payload = JSON.parse(raw.slice(CHAT_IMAGE_PREFIX.length));
    if (/^https?:\/\//i.test(payload.url || '')) {
      return { type: 'image', url: payload.url, caption: String(payload.caption || '') };
    }
  } catch {
    // Hiển thị nội dung thô nếu một tin nhắn ảnh cũ bị hỏng dữ liệu.
  }
  return { type: 'text', text: raw };
}

function renderChatMessages(messages, selector, viewerRole) {
  const container = $(selector);
  if (!container) return;
  // Chat được kiểm tra mỗi 4 giây. Nếu không có tin mới, không thay lại toàn
  // bộ DOM vì thao tác đó làm trình duyệt đưa khung chat về đầu.
  const messageSignature = JSON.stringify(messages.map(({ id, sender_role, content, created_at }) => ({
    id,
    sender_role,
    content,
    created_at
  })));
  if (container.dataset.messageSignature === messageSignature) return;

  const previousScrollTop = container.scrollTop;
  const shouldStickToBottom = !container.dataset.ready || container.scrollHeight - container.scrollTop - container.clientHeight < 90;
  let previousDateKey = '';
  container.innerHTML = messages.length ? messages.map((message) => {
    const own = message.sender_role === viewerRole;
    const sender = own ? (viewerRole === 'admin' ? 'Anh' : 'Vy') : (viewerRole === 'admin' ? 'Vy' : 'Anh');
    const parsed = parseChatMessage(message.content);
    const currentDateKey = chatDateKey(message.created_at);
    const dateSeparator = currentDateKey !== previousDateKey
      ? `<div class="chat-date-separator" role="separator"><span>${escapeHtml(chatDateLabel(message.created_at))}</span></div>`
      : '';
    previousDateKey = currentDateKey;
    let content = parsed.type === 'call'
      ? `<div class="chat-call-bubble"><span class="chat-call-icon">${parsed.callType === 'voice' ? '☎' : '▣'}</span><strong>${parsed.callType === 'voice' ? 'Cuộc gọi thoại' : 'Cuộc gọi video'}</strong><span>${parsed.status === 'declined' ? 'Cuộc gọi bị từ chối' : parsed.status === 'missed' ? 'Cuộc gọi nhỡ' : `Đã kết thúc · ${formatCallDuration(Number(parsed.duration || 0))}`}</span><button type="button" data-call-retry="${escapeHtml(parsed.callType || 'video')}">Gọi lại</button></div>`
      : parsed.type === 'image'
      ? `<a class="chat-image-link" href="${escapeHtml(parsed.url)}" target="_blank" rel="noopener"><img class="chat-image" src="${escapeHtml(parsed.url)}" alt="Ảnh ${sender} gửi" loading="lazy" /></a>${parsed.caption ? `<p class="chat-image-caption">${escapeHtml(parsed.caption).replace(/\r?\n/g, '<br />')}</p>` : ''}`
      : `<p>${escapeHtml(parsed.text).replace(/\r?\n/g, '<br />')}</p>`;
    return `${dateSeparator}<article class="chat-message ${own ? 'is-mine' : 'is-theirs'}" data-message-id="${escapeHtml(message.id)}">
      <div class="chat-bubble">${content}<time datetime="${escapeHtml(message.created_at)}">${sender} · ${chatTime(message.created_at)}</time></div>
    </article>`;
  }).join('') : '<p class="chat-empty">Chưa có tin nhắn nào. Nhắn một câu thật ngọt cho người thương nha 💗</p>';
  container.dataset.ready = 'true';
  container.dataset.messageSignature = messageSignature;
  messages.forEach((message) => {
    const article = container.querySelector(`article[data-message-id="${String(message.id)}"]`);
    const bubble = article?.querySelector('.chat-bubble');
    if (!bubble) return;
    const tools = document.createElement('div');
    tools.className = 'chat-message-tools';
    const counts = Object.values(message.reactions || {}).reduce((result, reaction) => { if (reaction) result[reaction] = (result[reaction] || 0) + 1; return result; }, {});
    Object.entries(counts).forEach(([reaction, count]) => { const badge = document.createElement('span'); badge.className = 'chat-reaction-count'; badge.textContent = `${reaction} ${count > 1 ? count : ''}`; tools.appendChild(badge); });
    const button = document.createElement('button');
    button.className = 'chat-reaction-button'; button.type = 'button'; button.dataset.chatReaction = String(message.id); button.setAttribute('aria-label', 'Thả reaction'); button.textContent = '💗';
    tools.appendChild(button); bubble.appendChild(tools);
  });
  container.querySelectorAll('[data-chat-reaction]').forEach((button) => button.addEventListener('click', async () => {
    const token = viewerRole === 'admin' ? localStorage.getItem(ADMIN_TOKEN_KEY) : '';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    button.disabled = true;
    try {
      const response = await fetch(`/api/chat/messages/${button.dataset.chatReaction}/reaction`, { method: 'POST', headers, body: JSON.stringify({ role: viewerRole, reaction: '💗' }) });
      if (!response.ok) throw new Error('Chưa thả reaction được nha.');
      await loadChatMessages(viewerRole, true);
    } catch (error) { showToast(error.message); } finally { button.disabled = false; }
  }));
  container.querySelectorAll('[data-call-retry]').forEach((button) => button.addEventListener('click', () => openCallLobby(viewerRole, button.dataset.callRetry === 'voice' ? 'voice' : 'video')));

  if (shouldStickToBottom) {
    container.scrollTop = container.scrollHeight;
  } else {
    // Người dùng đang đọc tin cũ: giữ nguyên đúng vị trí đó dù có tin mới.
    container.scrollTop = previousScrollTop;
  }
}

function handleAdminSessionExpired() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  stopChatPolling();
  $('#adminScreen').hidden = true;
  $('#appShell').hidden = true;
  $('#loginScreen').hidden = false;
  $('#loginForm').hidden = true;
  $('#showAdminLogin').hidden = true;
  $('#adminLoginPanel').hidden = false;
  $('#adminLoginError').textContent = 'Phiên của anh đã hết hạn, đăng nhập lại một lần nha.';
}

async function loadChatMessages(viewerRole = 'vy', silent = false) {
  if (state.chatLoading) return;
  const token = viewerRole === 'admin' ? localStorage.getItem(ADMIN_TOKEN_KEY) : '';
  if (viewerRole === 'admin' && !token) return;
  state.chatLoading = true;
  const status = viewerRole === 'admin' ? $('#adminChatStatus') : $('#chatStatus');
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await fetch(`/api/chat/messages?role=${viewerRole}`, { headers });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && viewerRole === 'admin') {
      handleAdminSessionExpired();
      return;
    }
    if (!response.ok) throw new Error(data.error || 'Chưa tải được tin nhắn.');
    renderChatMessages(data.messages || [], viewerRole === 'admin' ? '#adminChatMessages' : '#chatMessages', viewerRole);
    if (status && !silent) status.textContent = '';
  } catch (error) {
    if (status && !silent) status.textContent = error.message;
  } finally {
    state.chatLoading = false;
  }
}

async function sendChatMessage(senderRole = 'vy') {
  const input = senderRole === 'admin' ? $('#adminChatInput') : $('#chatInput');
  const imageInput = senderRole === 'admin' ? $('#adminChatImageInput') : $('#chatImageInput');
  const button = senderRole === 'admin' ? $('#sendAdminChat') : $('#sendChat');
  const status = senderRole === 'admin' ? $('#adminChatStatus') : $('#chatStatus');
  const content = input.value.trim();
  const file = imageInput?.files?.[0];
  if (!content && !file) {
    status.textContent = 'Viết một điều hoặc chọn ảnh muốn gửi trước nha 💗';
    input.focus();
    return;
  }
  const token = senderRole === 'admin' ? localStorage.getItem(ADMIN_TOKEN_KEY) : '';
  button.disabled = true;
  try {
    status.textContent = file ? 'Đang chuẩn bị ảnh để gửi nha…' : '';
    const imageDataUrl = file ? await prepareChatImage(file) : '';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch('/api/chat/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({ senderRole, content, imageDataUrl })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Chưa gửi được tin nhắn.');
    input.value = '';
    if (imageInput) imageInput.value = '';
    clearChatImagePreview(senderRole);
    status.textContent = senderRole === 'admin' ? 'Đã gửi cho Vy 💌' : 'Đã gửi cho anh 💌';
    await loadChatMessages(senderRole);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    input.focus();
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Không đọc được ảnh, thử chọn ảnh khác nha.'));
    reader.readAsDataURL(file);
  });
}

async function prepareChatImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Vui lòng chọn một file ảnh nha.');
  const source = await readFileAsDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const preview = new Image();
    preview.onload = () => resolve(preview);
    preview.onerror = () => reject(new Error('Ảnh này chưa được iPhone hỗ trợ, hãy chọn JPG hoặc PNG nha.'));
    preview.src = source;
  });
  const maxDimension = 1600;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.84);
}

function clearChatImagePreview(senderRole) {
  const preview = $(senderRole === 'admin' ? '#adminChatImagePreview' : '#chatImagePreview');
  if (preview) preview.hidden = true;
}

function bindChatImagePicker(senderRole) {
  const input = $(senderRole === 'admin' ? '#adminChatImageInput' : '#chatImageInput');
  const preview = $(senderRole === 'admin' ? '#adminChatImagePreview' : '#chatImagePreview');
  const previewImage = $(senderRole === 'admin' ? '#adminChatImagePreviewImage' : '#chatImagePreviewImage');
  const removeButton = $(senderRole === 'admin' ? '#removeAdminChatImage' : '#removeChatImage');
  if (!input || !preview || !previewImage || !removeButton) return;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) {
      clearChatImagePreview(senderRole);
      return;
    }
    if (!file.type.startsWith('image/')) {
      input.value = '';
      clearChatImagePreview(senderRole);
      showToast('Vy hãy chọn đúng file ảnh nha 💗');
      return;
    }
    previewImage.src = URL.createObjectURL(file);
    preview.hidden = false;
  });
  removeButton.addEventListener('click', () => {
    input.value = '';
    clearChatImagePreview(senderRole);
  });
}

function stopChatPolling() {
  if (state.chatTimer) clearInterval(state.chatTimer);
  state.chatTimer = null;
}

function startChatPolling(viewerRole) {
  stopChatPolling();
  loadChatMessages(viewerRole);
  state.chatTimer = setInterval(() => loadChatMessages(viewerRole, true), 4000);
}

function bindChatQuickReplies() {
  $$('[data-chat-quick]').forEach((button) => button.addEventListener('click', () => {
    const input = $(button.dataset.chatTarget);
    if (!input) return;
    input.value = `${input.value}${input.value ? ' ' : ''}${button.dataset.chatQuick}`;
    input.focus();
  }));
}

function callElements(role) {
  const admin = role === 'admin';
  return {
    section: $(admin ? '#adminCallSection' : '#callSection'),
    incoming: $(admin ? '#adminIncomingCall' : '#incomingCall'),
    incomingTitle: $(admin ? '#adminIncomingCallTitle' : '#incomingCallTitle'),
    incomingDescription: $(admin ? '#adminIncomingCallDescription' : '#incomingCallDescription'),
    accept: $(admin ? '#acceptAdminCall' : '#acceptCall'),
    decline: $(admin ? '#declineAdminCall' : '#declineCall'),
    stage: $(admin ? '#adminCallStage' : '#callStage'),
    videos: $(admin ? '#adminCallVideos' : '#callVideos'),
    filters: $(admin ? '#adminCallFilters' : '#callFilters'),
    filterToggle: $(admin ? '#toggleAdminCallFilters' : '#toggleCallFilters'),
    shortcuts: $(admin ? '#adminCallShortcuts' : '#callShortcuts'),
    toolSheet: $(admin ? '#adminCallToolSheet' : '#callToolSheet'),
    waiting: $(admin ? '#adminCallWaiting' : '#callWaiting'),
    waitingTitle: $(admin ? '#adminCallWaitingTitle' : '#callWaitingTitle'),
    waitingStatus: $(admin ? '#adminCallWaitingStatus' : '#callWaitingStatus'),
    timer: $(admin ? '#adminCallTimer' : '#callTimer'),
    lobby: $(admin ? '#adminCallLobby' : '#callLobby'),
    miniChat: $(admin ? '#adminCallMiniChat' : '#callMiniChat'),
    miniChatToggle: $(admin ? '#adminCallMiniChatToggle' : '#callMiniChatToggle'),
    speaker: $(admin ? '#adminCallSpeaker' : '#callSpeaker'),
    layout: $(admin ? '#adminCallLayout' : '#callLayout'),
    close: $(admin ? '#closeAdminCall' : '#closeCall'),
    status: $(admin ? '#adminCallStatus' : '#callStatus'),
    start: $(admin ? '#startAdminVideoCall' : '#startVideoCall'),
    join: $(admin ? '#joinAdminVideoCall' : '#joinVideoCall'),
    camera: $(admin ? '#toggleAdminCamera' : '#toggleCamera'),
    microphone: $(admin ? '#toggleAdminMicrophone' : '#toggleMicrophone'),
    share: $(admin ? '#adminShareCallScreen' : '#shareCallScreen'),
    end: $(admin ? '#endAdminCall' : '#endCall')
  };
}

function ensureCallExperience(role) {
  const elements = callElements(role);
  if (!elements.section || !elements.stage) return elements;
  const admin = role === 'admin';
  const prefix = admin ? 'admin' : '';
  if (!elements.waiting) {
    const waiting = document.createElement('div');
    waiting.id = admin ? 'adminCallWaiting' : 'callWaiting';
    waiting.className = 'call-waiting-hero';
    waiting.innerHTML = `<div class="call-waiting-avatar"><img src="${AVATAR_IMAGE_URL}" alt="" /></div><h3 id="${admin ? 'adminCallWaitingTitle' : 'callWaitingTitle'}">${admin ? 'Vy' : 'Anh'}</h3><p id="${admin ? 'adminCallWaitingStatus' : 'callWaitingStatus'}">Đang gọi…</p>`;
    elements.section.insertBefore(waiting, elements.incoming);
  }
  if (!elements.timer) {
    const timer = document.createElement('span');
    timer.id = admin ? 'adminCallTimer' : 'callTimer';
    timer.className = 'call-timer';
    timer.hidden = true;
    timer.textContent = '00:00';
    elements.section.querySelector('.section-heading')?.appendChild(timer);
  }
  if (!elements.lobby) {
    const lobby = document.createElement('div');
    lobby.id = admin ? 'adminCallLobby' : 'callLobby';
    lobby.className = 'call-lobby';
    lobby.hidden = true;
    lobby.innerHTML = `<div class="call-lobby-copy"><span class="call-lobby-kicker">GÓC HẸN RIÊNG</span><h3 data-call-lobby-name>${admin ? 'Vy' : 'Anh'}</h3><p data-call-lobby-type>Chuẩn bị cuộc gọi video</p></div><div class="call-lobby-permissions"><span data-call-permission="camera">Camera đang chờ quyền</span><span data-call-permission="microphone">Micro đang chờ quyền</span></div><div class="call-lobby-actions"><button type="button" class="call-lobby-circle" data-call-lobby-camera aria-label="Bật hoặc tắt camera">▣</button><button type="button" class="call-lobby-circle" data-call-lobby-mic aria-label="Bật hoặc tắt microphone">🎙</button><button type="button" class="call-lobby-circle" data-call-lobby-switch aria-label="Đổi camera">⇄</button></div><div class="call-lobby-buttons"><button type="button" class="button button-light" data-call-lobby-cancel>Hủy</button><button type="button" class="button button-primary" data-call-lobby-voice>Gọi thoại</button><button type="button" class="button button-primary" data-call-lobby-video>Gọi video</button></div>`;
    elements.section.insertBefore(lobby, elements.incoming);
  }
  if (!elements.shortcuts) {
    const shortcuts = document.createElement('div');
    shortcuts.id = admin ? 'adminCallShortcuts' : 'callShortcuts';
    shortcuts.className = 'call-shortcuts';
    shortcuts.setAttribute('aria-label', 'Công cụ cuộc gọi');
    shortcuts.innerHTML = [
      ['edit', '✣', 'Chỉnh sửa'],
      ['blur', '◌', 'Làm mờ'],
      ['effects', '☻', 'Hiệu ứng'],
      ['background', '▧', 'Phông nền'],
      ['color', '◉', 'Bộ lọc màu']
    ].map(([id, icon, label]) => `<button type="button" class="call-shortcut" data-call-tool="${id}"><span>${icon}</span>${label}</button>`).join('');
    elements.stage.insertBefore(shortcuts, elements.stage.querySelector('.call-controls'));
  }
  if (!elements.toolSheet) {
    const sheet = document.createElement('div');
    sheet.id = admin ? 'adminCallToolSheet' : 'callToolSheet';
    sheet.className = 'call-tool-sheet';
    sheet.hidden = true;
    sheet.innerHTML = '<div class="call-sheet-grabber" aria-hidden="true"></div><div class="call-sheet-header"><strong data-call-sheet-title>Chọn công cụ</strong><button type="button" class="call-sheet-close" data-call-sheet-close aria-label="Đóng bảng công cụ">×</button></div><div class="call-sheet-items" data-call-sheet-items></div>';
    elements.stage.appendChild(sheet);
  }
  if (!elements.miniChat) {
    const miniChat = document.createElement('div');
    miniChat.id = admin ? 'adminCallMiniChat' : 'callMiniChat';
    miniChat.className = 'call-mini-chat';
    miniChat.hidden = true;
    miniChat.innerHTML = `<div class="call-mini-chat-header"><strong>Nhắn nhanh</strong><button type="button" data-call-mini-close aria-label="Đóng chat">×</button></div><div class="call-mini-chat-messages" data-call-mini-messages></div><form class="call-mini-chat-form"><input type="text" maxlength="300" placeholder="Nhắn một câu…" aria-label="Tin nhắn trong cuộc gọi" /><button type="submit" aria-label="Gửi tin nhắn">➤</button></form>`;
    elements.stage.appendChild(miniChat);
  }
  const refreshed = callElements(role);
  const incomingAvatar = refreshed.incoming?.querySelector('.call-incoming-avatar');
  if (incomingAvatar && !incomingAvatar.dataset.enhanced) {
    incomingAvatar.dataset.enhanced = 'true';
    incomingAvatar.innerHTML = `<img src="${AVATAR_IMAGE_URL}" alt="" />`;
  }
  const incomingActions = refreshed.incoming?.querySelector('.call-incoming-actions');
  if (incomingActions && !incomingActions.querySelector('[data-call-message]')) {
    const messageButton = document.createElement('button');
    messageButton.type = 'button';
    messageButton.className = 'button button-light call-incoming-secondary';
    messageButton.dataset.callMessage = role;
    messageButton.textContent = 'Nhắn tin';
    incomingActions.appendChild(messageButton);
    messageButton.addEventListener('click', () => focusChatAfterCall(role));
  }
  if (incomingActions && !incomingActions.querySelector('[data-call-remind]')) {
    const remindButton = document.createElement('button');
    remindButton.type = 'button';
    remindButton.className = 'button button-light call-incoming-secondary';
    remindButton.dataset.callRemind = role;
    remindButton.textContent = 'Nhắc tôi sau';
    incomingActions.appendChild(remindButton);
    remindButton.addEventListener('click', () => {
      stopIncomingCallAlert();
      sendCallHistoryMessage(role, 'missed').catch(() => {});
      closeCallOverlay(role);
    });
  }
  if (!refreshed.shortcuts.dataset.bound) {
    refreshed.shortcuts.dataset.bound = 'true';
    refreshed.shortcuts.querySelectorAll('[data-call-tool]').forEach((button) => button.addEventListener('click', () => setCallTool(role, button.dataset.callTool)));
    refreshed.toolSheet.querySelector('[data-call-sheet-close]')?.addEventListener('click', () => closeCallToolSheet(role));
    refreshed.lobby.querySelector('[data-call-lobby-cancel]')?.addEventListener('click', () => closeCallOverlay(role));
    refreshed.lobby.querySelector('[data-call-lobby-video]')?.addEventListener('click', () => joinLiveKitCall(role, true, 'video'));
    refreshed.lobby.querySelector('[data-call-lobby-voice]')?.addEventListener('click', () => joinLiveKitCall(role, true, 'voice'));
    refreshed.lobby.querySelector('[data-call-lobby-camera]')?.addEventListener('click', () => toggleCallCamera(role));
    refreshed.lobby.querySelector('[data-call-lobby-mic]')?.addEventListener('click', () => toggleCallMicrophone(role));
    refreshed.lobby.querySelector('[data-call-lobby-switch]')?.addEventListener('click', () => switchCallCamera(role));
    refreshed.miniChat.querySelector('[data-call-mini-close]')?.addEventListener('click', () => toggleMiniCallChat(role, false));
    refreshed.miniChat.querySelector('form')?.addEventListener('submit', (event) => { event.preventDefault(); sendMiniCallMessage(role); });
    bindCallSurfaceInteractions(role);
  }
  ensureExtraCallButtons(role);
  ensureCallReactionButton(role, '😮');
  return refreshed;
}

function focusChatAfterCall(role) {
  stopIncomingCallAlert();
  closeCallOverlay(role);
  const input = $(role === 'admin' ? '#adminChatInput' : '#chatInput');
  input?.focus();
  input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function ensureCallReactionButton(role, emoji) {
  const elements = callElements(role);
  const tray = elements.stage?.querySelector('.call-reaction-tray');
  if (!tray || tray.querySelector(`[data-call-reaction="${emoji}"]`)) return;
  const button = document.createElement('button');
  button.className = 'call-reaction-button';
  button.type = 'button';
  button.dataset.callReaction = emoji;
  button.textContent = emoji;
  button.setAttribute('aria-label', `Gửi reaction ${emoji}`);
  tray.appendChild(button);
  button.addEventListener('click', () => sendCallReaction(role, emoji));
}

function ensureExtraCallButtons(role) {
  const elements = callElements(role);
  const controls = elements.stage?.querySelector('.call-controls');
  if (!controls || !elements.end) return;
  const create = (id, dataName, title, icon, before = elements.end) => {
    const dataAttribute = dataName.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    let button = controls.querySelector(`[data-${dataAttribute}]`);
    if (!button) {
      button = document.createElement('button');
      button.id = id;
      button.type = 'button';
      button.className = 'button button-light call-control-icon';
      button.setAttribute(`data-${dataAttribute}`, role);
      button.title = title;
      button.setAttribute('aria-label', title);
      button.textContent = title;
      button.innerHTML = `<span aria-hidden="true">${icon}</span>`;
      controls.insertBefore(button, before);
    }
    return button;
  };
  const speaker = create(role === 'admin' ? 'adminCallSpeaker' : 'callSpeaker', 'callSpeaker', 'Bật hoặc tắt loa', '🔊');
  const layout = create(role === 'admin' ? 'adminCallLayout' : 'callLayout', 'callLayout', 'Đổi bố cục video', '▦', speaker);
  const chat = create(role === 'admin' ? 'adminCallMiniChatToggle' : 'callMiniChatToggle', 'callMiniChatToggle', 'Mở chat mini', '💬', layout);
  if (!speaker.dataset.bound) { speaker.dataset.bound = 'true'; speaker.addEventListener('click', () => toggleCallSpeaker(role)); }
  if (!layout.dataset.bound) { layout.dataset.bound = 'true'; layout.addEventListener('click', () => toggleCallLayout(role)); }
  if (!chat.dataset.bound) { chat.dataset.bound = 'true'; chat.addEventListener('click', () => toggleMiniCallChat(role)); }
}

function getCallUiState(role) {
  if (!callUiStates.has(role)) callUiStates.set(role, { status: 'idle', startedAt: 0, timer: null, idleTimer: null, controlsHidden: false, speakerOn: true, reactionCooldownUntil: 0, historySent: false, callType: 'video' });
  return callUiStates.get(role);
}

function setCallUiState(role, status) {
  const state = getCallUiState(role);
  state.status = status;
  const elements = callElements(role);
  elements.section?.classList.toggle('is-incoming', status === 'incoming');
  elements.section?.classList.toggle('is-connecting', status === 'connecting');
  elements.section?.classList.toggle('is-connected', status === 'connected');
  elements.section?.classList.toggle('is-ended', status === 'ended' || status === 'declined');
}

function formatCallDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function stopCallUiTimer(role) {
  const state = getCallUiState(role);
  if (state.timer) window.clearInterval(state.timer);
  state.timer = null;
  state.startedAt = 0;
  const elements = callElements(role);
  if (elements.timer) {
    elements.timer.hidden = true;
    elements.timer.textContent = '00:00';
  }
}

function startCallUiTimer(role) {
  const state = getCallUiState(role);
  if (state.timer) return;
  state.startedAt = Date.now();
  setCallUiState(role, 'connected');
  const elements = callElements(role);
  if (elements.timer) elements.timer.hidden = false;
  const tick = () => {
    const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
    if (elements.timer) elements.timer.textContent = formatCallDuration(elapsed);
  };
  tick();
  state.timer = window.setInterval(tick, 1000);
}

function showCallControls(role, visible = true) {
  const state = getCallUiState(role);
  const elements = callElements(role);
  state.controlsHidden = !visible;
  elements.section?.classList.toggle('call-ui-idle', !visible);
  if (visible) scheduleCallControlsHide(role);
}

function scheduleCallControlsHide(role) {
  const state = getCallUiState(role);
  if (state.idleTimer) window.clearTimeout(state.idleTimer);
  if (state.status !== 'connected') return;
  state.idleTimer = window.setTimeout(() => showCallControls(role, false), 4000);
}

function bindCallSurfaceInteractions(role) {
  const elements = callElements(role);
  if (!elements.stage || elements.stage.dataset.surfaceBound) return;
  elements.stage.dataset.surfaceBound = 'true';
  elements.stage.addEventListener('click', (event) => {
    if (event.target.closest('.call-controls, .call-shortcuts, .call-tool-sheet, .call-filters, .call-close, .call-incoming, button')) return;
    if (getCallUiState(role).status === 'connected') showCallControls(role, getCallUiState(role).controlsHidden);
  });
  elements.videos.addEventListener('pointerdown', (event) => {
    const tile = event.target.closest('.call-tile.is-local-preview');
    if (!tile || !elements.videos.classList.contains('has-remote')) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = tile.offsetLeft;
    const startTop = tile.offsetTop;
    const stageRect = elements.videos.getBoundingClientRect();
    const tileRect = tile.getBoundingClientRect();
    let moved = false;
    tile.setPointerCapture?.(event.pointerId);
    const move = (moveEvent) => {
      const nextLeft = Math.max(8, Math.min(stageRect.width - tileRect.width - 8, startLeft + moveEvent.clientX - startX));
      const nextTop = Math.max(62, Math.min(stageRect.height - tileRect.height - 90, startTop + moveEvent.clientY - startY));
      if (Math.abs(moveEvent.clientX - startX) > 4 || Math.abs(moveEvent.clientY - startY) > 4) moved = true;
      tile.style.left = `${nextLeft}px`;
      tile.style.top = `${nextTop}px`;
      tile.style.right = 'auto';
      tile.style.bottom = 'auto';
    };
    const end = () => {
      tile.releasePointerCapture?.(event.pointerId);
      tile.removeEventListener('pointermove', move);
      tile.removeEventListener('pointerup', end);
      tile.removeEventListener('pointercancel', end);
      tile.classList.toggle('is-dragging', moved);
    };
    tile.addEventListener('pointermove', move);
    tile.addEventListener('pointerup', end);
    tile.addEventListener('pointercancel', end);
  });
}

function closeCallToolSheet(role) {
  const elements = ensureCallExperience(role);
  if (!elements.toolSheet) return;
  elements.toolSheet.hidden = true;
  elements.shortcuts?.querySelectorAll('[data-call-tool]').forEach((button) => button.classList.remove('active'));
}

function renderCallToolSheet(role, type) {
  const elements = ensureCallExperience(role);
  if (!elements.toolSheet) return;
  const presets = type === 'background' ? CALL_BACKGROUND_PRESETS : CALL_COLOR_PRESETS;
  const title = type === 'background' ? 'Chọn phông nền' : 'Bộ lọc màu';
  const active = activeFilterPipeline?.role === role
    ? (type === 'background' ? (activeFilterPipeline.backgroundPreset || 'none') : (activeFilterPipeline.colorFilter || 'none'))
    : 'none';
  elements.toolSheet.querySelector('[data-call-sheet-title]').textContent = title;
  elements.toolSheet.querySelector('[data-call-sheet-items]').innerHTML = presets.map((preset) => `<button type="button" class="call-sheet-item${preset.id === active ? ' active' : ''}" data-call-sheet-type="${type}" data-call-sheet-value="${preset.id}"><span class="call-sheet-preview" style="${type === 'background' ? `background:${preset.background}` : ''}">${preset.emoji}</span><b>${preset.label}</b></button>`).join('');
  elements.toolSheet.querySelectorAll('[data-call-sheet-value]').forEach((button) => button.addEventListener('click', () => {
    if (type === 'background') applyCallBackground(role, button.dataset.callSheetValue);
    else applyCallColor(role, button.dataset.callSheetValue);
    renderCallToolSheet(role, type);
  }));
  elements.toolSheet.hidden = false;
}

function setCallTool(role, tool) {
  const elements = ensureCallExperience(role);
  elements.shortcuts?.querySelectorAll('[data-call-tool]').forEach((button) => button.classList.toggle('active', button.dataset.callTool === tool));
  if (tool === 'effects') {
    closeCallToolSheet(role);
    toggleCallFilters(role, true);
    elements.shortcuts?.querySelector('[data-call-tool="effects"]')?.classList.add('active');
    return;
  }
  if (tool === 'background' || tool === 'color') {
    elements.filters.hidden = true;
    elements.filters.style.display = 'none';
    renderCallToolSheet(role, tool);
    return;
  }
  closeCallToolSheet(role);
  const pipeline = activeFilterPipeline?.role === role ? activeFilterPipeline : null;
  if (tool === 'blur') {
    if (!pipeline) return setCallStatus(role, 'Camera chưa sẵn sàng để làm mờ nha.');
    pipeline.backgroundMode = pipeline.backgroundMode === 'blur' ? 'none' : 'blur';
    elements.stage.classList.toggle('is-background-blurred', pipeline.backgroundMode === 'blur');
    setCallStatus(role, pipeline.backgroundMode === 'blur' ? 'Đã bật làm mờ phông nền.' : 'Đã tắt làm mờ phông nền.');
  } else if (tool === 'edit') {
    if (!pipeline) return setCallStatus(role, 'Camera chưa sẵn sàng để chỉnh sửa nha.');
    pipeline.editEnabled = !pipeline.editEnabled;
    elements.stage.classList.toggle('is-edited', pipeline.editEnabled);
    setCallStatus(role, pipeline.editEnabled ? 'Đã bật chỉnh sửa hình ảnh.' : 'Đã tắt chỉnh sửa hình ảnh.');
  }
}

function applyCallBackground(role, presetId) {
  const preset = CALL_BACKGROUND_PRESETS.find((item) => item.id === presetId) || CALL_BACKGROUND_PRESETS[0];
  const pipeline = activeFilterPipeline?.role === role ? activeFilterPipeline : null;
  if (!pipeline) return setCallStatus(role, 'Camera chưa sẵn sàng để đổi phông nền nha.');
  pipeline.backgroundPreset = preset.id;
  pipeline.backgroundMode = preset.id === 'none' ? 'none' : 'replace';
  const elements = callElements(role);
  elements.stage.dataset.background = preset.id;
  setCallStatus(role, preset.id === 'none' ? 'Đã dùng phông nền gốc.' : `Đã chọn phông nền ${preset.label}.`);
}

function applyCallColor(role, presetId) {
  const preset = CALL_COLOR_PRESETS.find((item) => item.id === presetId) || CALL_COLOR_PRESETS[0];
  const pipeline = activeFilterPipeline?.role === role ? activeFilterPipeline : null;
  if (!pipeline) return setCallStatus(role, 'Camera chưa sẵn sàng để đổi màu nha.');
  pipeline.colorFilter = preset.id;
  callElements(role).stage.dataset.color = preset.id;
  setCallStatus(role, preset.id === 'none' ? 'Đã dùng màu gốc.' : `Đã chọn bộ lọc màu ${preset.label}.`);
}

function updateCallLobbyPermissions(role) {
  const elements = callElements(role);
  const pipeline = activeFilterPipeline?.role === role ? activeFilterPipeline : null;
  const cameraTrack = pipeline?.sourceStream?.getVideoTracks?.()[0];
  const micTrack = pipeline?.sourceStream?.getAudioTracks?.()[0];
  const cameraLabel = elements.lobby?.querySelector('[data-call-permission="camera"]');
  const micLabel = elements.lobby?.querySelector('[data-call-permission="microphone"]');
  if (cameraLabel) cameraLabel.textContent = cameraTrack ? (cameraTrack.enabled ? 'Camera đã sẵn sàng' : 'Camera đang tắt') : 'Camera chưa được cấp quyền';
  if (micLabel) micLabel.textContent = micTrack ? (micTrack.enabled ? 'Micro đã sẵn sàng' : 'Micro đang tắt') : 'Micro chưa được cấp quyền';
}

function setCallStatus(role, message) {
  const elements = callElements(role);
  if (elements.status) elements.status.textContent = message;
  if (elements.waitingStatus) elements.waitingStatus.textContent = message;
  updateCallLobbyPermissions(role);
}

function ensureSwitchCameraButton(role) {
  const elements = callElements(role);
  const controls = elements.stage?.querySelector('.call-controls');
  if (!controls || !elements.filterToggle) return null;
  let button = controls.querySelector('[data-switch-call-camera]');
  if (!button) {
    button = document.createElement('button');
    button.className = 'button button-light call-control-icon';
    button.type = 'button';
    button.dataset.switchCallCamera = role;
    button.title = 'Đổi camera trước/sau';
    button.setAttribute('aria-label', 'Đổi camera trước sau');
    button.textContent = 'Đổi camera';
    controls.insertBefore(button, elements.filterToggle);
    button.addEventListener('click', () => switchCallCamera(role));
  }
  return button;
}

function ensureScreenShareButton(role) {
  const elements = callElements(role);
  const controls = elements.stage?.querySelector('.call-controls');
  if (!controls || !elements.end) return null;
  let button = controls.querySelector('[data-call-screen-share]');
  if (!button) {
    button = document.createElement('button');
    button.id = role === 'admin' ? 'adminShareCallScreen' : 'shareCallScreen';
    button.className = 'button button-light call-control-icon';
    button.type = 'button';
    button.dataset.callScreenShare = role;
    button.title = 'Chia sẻ màn hình';
    button.setAttribute('aria-label', 'Chia sẻ màn hình');
    button.textContent = 'Chia sẻ';
    controls.insertBefore(button, elements.end);
    button.addEventListener('click', () => toggleCallScreenShare(role));
  }
  return button;
}

function setCallControls(role, connected) {
  const elements = ensureCallExperience(role);
  if (!elements.stage) return;
  const switchCamera = ensureSwitchCameraButton(role);
  const screenShare = ensureScreenShareButton(role);
  elements.stage.hidden = !connected;
  elements.waiting.hidden = connected && activeFilterPipeline?.role === role;
  elements.incoming.hidden = true;
  elements.start.disabled = connected;
  elements.join.disabled = connected;
  elements.camera.disabled = !connected || activeCallType === 'voice';
  elements.microphone.disabled = !connected;
  elements.filterToggle.disabled = !connected || activeCallType === 'voice';
  if (switchCamera) switchCamera.disabled = !connected || activeCallType === 'voice';
  if (screenShare) screenShare.disabled = !connected || activeCallType === 'voice' || typeof navigator.mediaDevices?.getDisplayMedia !== 'function';
  if (!connected && screenShare) {
    screenShare.classList.remove('is-active');
    screenShare.setAttribute('aria-pressed', 'false');
  }
  elements.filterToggle.setAttribute('aria-expanded', connected && !elements.filters.hidden ? 'true' : 'false');
  if (connected && activeCallType === 'video') {
    elements.filters.hidden = true;
    elements.filters.style.display = 'none';
    elements.filters.classList.remove('is-open');
    elements.toolSheet.hidden = true;
  }
  elements.end.disabled = !connected;
}

function openCallOverlay(role) {
  const elements = ensureCallExperience(role);
  if (!elements.section) return;
  setCallUiState(role, 'connecting');
  stopCallUiTimer(role);
  const uiState = getCallUiState(role);
  uiState.historySent = false;
  uiState.callType = 'video';
  if (uiState.idleTimer) window.clearTimeout(uiState.idleTimer);
  uiState.controlsHidden = false;
  elements.section.hidden = false;
  elements.section.classList.remove('call-ui-idle');
  elements.lobby.hidden = true;
  elements.incoming.hidden = true;
  elements.stage.hidden = true;
  elements.waiting.hidden = false;
  elements.waitingStatus.textContent = 'Đang gọi…';
  elements.filters.hidden = true;
  elements.toolSheet.hidden = true;
  elements.videos.innerHTML = '';
  setCallFilter(role, 'none');
}

async function openCallLobby(role, callType = 'video') {
  const elements = ensureCallExperience(role);
  openCallOverlay(role);
  elements.lobby.hidden = false;
  elements.incoming.hidden = true;
  elements.waiting.hidden = true;
  elements.stage.hidden = callType !== 'video';
  elements.section.classList.add('is-lobby');
  elements.lobby.querySelector('[data-call-lobby-type]').textContent = callType === 'voice' ? 'Chuẩn bị cuộc gọi thoại' : 'Chuẩn bị cuộc gọi video';
  elements.lobby.querySelector('[data-call-lobby-video]').hidden = callType === 'voice';
  elements.lobby.querySelector('[data-call-lobby-camera]').disabled = callType === 'voice';
  elements.lobby.querySelector('[data-call-lobby-switch]').disabled = callType === 'voice';
  setCallUiState(role, 'connecting');
  getCallUiState(role).callType = callType;
  setCallStatus(role, callType === 'voice' ? 'Sẵn sàng gọi thoại.' : 'Đang xin quyền camera và microphone…');
  if (callType !== 'video') return;
  if (activeFilterPipeline?.role !== role) {
    try {
      const pipeline = await startFaceFilterPipeline(role, { deferFaceModel: true });
      if (activeFilterPipeline !== pipeline || elements.section.hidden || !elements.lobby || elements.lobby.hidden) {
        if (activeFilterPipeline === pipeline) stopFaceFilterPipeline();
        return;
      }
      elements.videos.innerHTML = '';
      attachCallTrack(role, pipeline.localVideoTrack, { identity: role === 'admin' ? 'anh' : 'vy', name: role === 'admin' ? 'Anh' : 'Vy' });
      updateCallLobbyPermissions(role);
      setCallStatus(role, 'Camera sẵn sàng. Chọn hiệu ứng rồi gọi nha.');
    } catch (error) {
      setCallStatus(role, 'Chưa mở được camera. Hãy cấp quyền camera và microphone rồi thử lại nha.');
      console.warn('Không mở được camera preview:', error.message);
    }
  } else {
    updateCallLobbyPermissions(role);
  }
}

function closeCallOverlay(role) {
  const elements = ensureCallExperience(role);
  if (!elements.section) return;
  if (!livekitRoom && activeFilterPipeline?.role === role) stopFaceFilterPipeline();
  const uiState = getCallUiState(role);
  if (uiState.idleTimer) window.clearTimeout(uiState.idleTimer);
  stopCallUiTimer(role);
  setCallUiState(role, 'idle');
  elements.section.hidden = true;
  elements.section.classList.remove('is-lobby');
  elements.lobby.hidden = true;
  elements.section.classList.remove('is-ringing');
  elements.incoming.hidden = true;
  elements.stage.hidden = true;
  elements.waiting.hidden = true;
  elements.filters.hidden = true;
  elements.toolSheet.hidden = true;
  elements.videos.innerHTML = '';
  pendingIncomingCall = null;
  stopIncomingCallAlert();
}

function playIncomingCallTone() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!incomingAudioContext) incomingAudioContext = new AudioContextClass();
    const context = incomingAudioContext;
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(.12, now + .03);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .38);
    gain.connect(context.destination);
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.setValueAtTime(660, now + .19);
    oscillator.connect(gain);
    oscillator.start(now);
    oscillator.stop(now + .4);
  } catch (error) { console.warn('Không phát được chuông cuộc gọi:', error.message); }
}

function stopIncomingCallAlert() {
  if (incomingAlertTimer) window.clearInterval(incomingAlertTimer);
  incomingAlertTimer = null;
  incomingAlertRole = null;
  if (navigator.vibrate) navigator.vibrate(0);
  if (incomingAudioContext) {
    incomingAudioContext.close().catch(() => {});
    incomingAudioContext = null;
  }
}

function startIncomingCallAlert(role) {
  stopIncomingCallAlert();
  incomingAlertRole = role;
  const vibrate = () => { if (navigator.vibrate) navigator.vibrate([450, 180, 450, 180, 800]); };
  vibrate();
  playIncomingCallTone();
  incomingAlertTimer = window.setInterval(() => { vibrate(); playIncomingCallTone(); }, 2200);
}

function showIncomingCall(role, callType = 'video') {
  const elements = ensureCallExperience(role);
  if (!elements.section || !elements.incoming) return;
  pendingIncomingCall = { role, callType };
  openCallOverlay(role);
  getCallUiState(role).callType = callType;
  const caller = role === 'admin' ? 'Vy' : 'Anh';
  const callLabel = callType === 'voice' ? 'gọi thoại' : 'gọi video';
  elements.incomingTitle.textContent = `${caller} đang ${callLabel} cho ${role === 'admin' ? 'anh' : 'Vy'}`;
  elements.incomingDescription.textContent = callType === 'voice'
    ? 'Bấm nhận để mở cuộc gọi thoại riêng của hai đứa.'
    : 'Bấm nhận để mở camera và micro, rồi mình gặp nhau nha.';
  elements.accept.textContent = callType === 'voice' ? 'Nhận cuộc gọi' : 'Nhận video';
  elements.incoming.hidden = false;
  elements.waiting.hidden = true;
  elements.section.classList.add('is-ringing');
  setCallUiState(role, 'incoming');
  startIncomingCallAlert(role);
  setCallStatus(role, `${caller} đang chờ em nhận máy 💗`);
}

function setCallFilter(role, filter) {
  const elements = callElements(role);
  if (!elements.stage || !elements.filters) return;
  elements.stage.dataset.filter = filter;
  if (activeFilterPipeline?.role === role) activeFilterPipeline.filter = filter;
  elements.filters.querySelectorAll('[data-call-filter]').forEach((button) => {
    button.classList.toggle('active', button.dataset.callFilter === filter);
  });
}

function toggleCallFilters(role, forceOpen = null) {
  const elements = callElements(role);
  if (!elements.filters) return;
  const open = forceOpen === null ? elements.filters.hidden : forceOpen;
  elements.filters.hidden = !open;
  elements.filters.style.display = open ? 'block' : 'none';
  elements.filters.classList.toggle('is-open', open);
  const heading = elements.filters.querySelector('.call-filters-heading');
  if (heading && open) heading.textContent = 'Chọn hiệu ứng';
  elements.filterToggle.setAttribute('aria-expanded', String(open));
  if (open) elements.filters.querySelector('[data-call-filter].active')?.focus({ preventScroll: true });
}

async function loadFaceLandmarker() {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = (async () => {
      const vision = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs');
      const fileset = await vision.FilesetResolver.forVisionTasks(FACE_LANDMARKER_WASM_URL);
      return vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL_URL },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: .5,
        minFacePresenceConfidence: .5,
        minTrackingConfidence: .5
      });
    })().catch((error) => {
      faceLandmarkerPromise = null;
      throw error;
    });
  }
  return faceLandmarkerPromise;
}

function landmarkPoint(landmarks, index, width, height) {
  const point = landmarks?.[index];
  return point ? { x: point.x * width, y: point.y * height } : null;
}

function distanceBetween(first, second) {
  if (!first || !second) return 0;
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function drawHeart(context, x, y, size, color) {
  context.save();
  context.translate(x, y);
  context.scale(size / 32, size / 32);
  context.beginPath();
  context.moveTo(0, 11);
  context.bezierCurveTo(-17, -2, -14, -14, -6, -14);
  context.bezierCurveTo(-2, -14, 0, -10, 0, -7);
  context.bezierCurveTo(0, -10, 2, -14, 6, -14);
  context.bezierCurveTo(14, -14, 17, -2, 0, 11);
  context.closePath();
  context.fillStyle = color;
  context.shadowColor = 'rgba(255, 45, 126, .45)';
  context.shadowBlur = 6;
  context.fill();
  context.restore();
}

function drawEmoji(context, emoji, x, y, size) {
  if (!x || !y) return;
  context.save();
  context.font = `${Math.max(18, size)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(emoji, x, y);
  context.restore();
}

function drawFreckles(context, cheek, faceWidth, faceHeight) {
  if (!cheek) return;
  context.save();
  context.fillStyle = 'rgba(177, 94, 78, .8)';
  const dotSize = Math.max(1.8, faceWidth * .012);
  [-.1, -.05, 0, .05, .1].forEach((offset, index) => {
    context.beginPath();
    context.arc(cheek.x + offset * faceWidth, cheek.y - (index % 2) * faceHeight * .035, dotSize, 0, Math.PI * 2);
    context.fill();
  });
  context.restore();
}

function drawGlasses(context, leftEye, rightEye, faceWidth, faceHeight, color = '#29243d') {
  if (!leftEye || !rightEye) return;
  const lensRadiusX = faceWidth * .16;
  const lensRadiusY = faceHeight * .065;
  context.save();
  context.fillStyle = `${color}cc`;
  context.strokeStyle = '#fff';
  context.lineWidth = Math.max(2, faceWidth * .012);
  [leftEye, rightEye].forEach((eye) => {
    context.beginPath();
    context.ellipse(eye.x, eye.y, lensRadiusX, lensRadiusY, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });
  context.beginPath();
  context.moveTo(leftEye.x + lensRadiusX * .82, leftEye.y);
  context.lineTo(rightEye.x - lensRadiusX * .82, rightEye.y);
  context.stroke();
  context.restore();
}

function drawFallbackFaceEffect(pipeline) {
  const { context, canvas, filter } = pipeline;
  const width = canvas.width;
  const height = canvas.height;
  const centerX = width / 2;
  const centerY = height * .38;
  const size = Math.max(34, Math.min(width, height) * .12);
  if (filter === 'soft') {
    context.fillStyle = 'rgba(255, 174, 207, .16)';
    context.fillRect(0, 0, width, height);
  } else if (filter === 'rainbow') {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, 'rgba(255, 126, 180, .24)');
    gradient.addColorStop(.5, 'rgba(255, 235, 145, .12)');
    gradient.addColorStop(1, 'rgba(141, 218, 255, .24)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  } else {
    const fallbackEmoji = { hearts: '💗', bunny: '🐰', flower: '🌸', crown: '👑', blush: '😊', cat: '🐱', puppy: '🐶', glasses: '🕶️', freckles: '🌼', butterfly: '🦋', kiss: '💋', star: '⭐', devil: '😈' }[filter];
    if (fallbackEmoji) drawEmoji(context, fallbackEmoji, centerX, centerY, size);
  }
}

function drawCallBackground(context, width, height, presetId) {
  const palettes = {
    sunset: ['#ff9a9e', '#fad0c4', '#fbc2eb'],
    ocean: ['#0f4c75', '#3282b8', '#bbe1fa'],
    aurora: ['#141e30', '#243b55', '#7f53ac'],
    hearts: ['#7f1d5a', '#e83e8c', '#ffd0e6'],
    lavender: ['#654ea3', '#b88bb9', '#eaafc8']
  };
  const colors = palettes[presetId] || palettes.sunset;
  const gradient = context.createLinearGradient(0, 0, width, height);
  colors.forEach((color, index) => gradient.addColorStop(index / (colors.length - 1), color));
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  if (presetId === 'hearts') {
    context.font = `${Math.max(30, width * .08)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    context.globalAlpha = .34;
    ['💗', '✨', '💕', '💞'].forEach((emoji, index) => context.fillText(emoji, width * (.12 + index * .25), height * (.18 + (index % 2) * .45)));
    context.globalAlpha = 1;
  }
}

function drawCallSource(pipeline, faceLandmarks) {
  const { context, canvas, sourceVideo } = pipeline;
  const width = canvas.width;
  const height = canvas.height;
  const colorFilters = {
    dreamy: 'saturate(1.15) brightness(1.08) contrast(.94)',
    warm: 'sepia(.18) saturate(1.22) brightness(1.04)',
    cool: 'hue-rotate(155deg) saturate(.86) brightness(1.08)',
    pink: 'hue-rotate(315deg) saturate(1.32) brightness(1.05)',
    mono: 'grayscale(1) contrast(1.08)'
  };
  const visualFilter = `${colorFilters[pipeline.colorFilter] || ''}${pipeline.editEnabled ? ' saturate(1.12) brightness(1.06) contrast(.96)' : ''}`.trim() || 'none';
  const drawOriginal = (filter = visualFilter) => {
    context.save();
    context.filter = filter;
    context.drawImage(sourceVideo, 0, 0, width, height);
    context.restore();
  };

  if (pipeline.backgroundMode === 'replace' && pipeline.backgroundPreset !== 'none') {
    drawCallBackground(context, width, height, pipeline.backgroundPreset);
    const leftFace = landmarkPoint(faceLandmarks, 234, width, height);
    const rightFace = landmarkPoint(faceLandmarks, 454, width, height);
    const forehead = landmarkPoint(faceLandmarks, 10, width, height);
    const chin = landmarkPoint(faceLandmarks, 152, width, height);
    if (leftFace && rightFace && forehead && chin) {
      const faceWidth = distanceBetween(leftFace, rightFace);
      const faceHeight = distanceBetween(forehead, chin);
      context.save();
      context.beginPath();
      context.ellipse((leftFace.x + rightFace.x) / 2, forehead.y + faceHeight * .48, faceWidth * .78, faceHeight * 1.28, 0, 0, Math.PI * 2);
      context.clip();
      drawOriginal();
      context.restore();
    } else drawOriginal();
    return;
  }

  if (pipeline.backgroundMode === 'blur') {
    drawOriginal('blur(13px)');
    const leftFace = landmarkPoint(faceLandmarks, 234, width, height);
    const rightFace = landmarkPoint(faceLandmarks, 454, width, height);
    const forehead = landmarkPoint(faceLandmarks, 10, width, height);
    const chin = landmarkPoint(faceLandmarks, 152, width, height);
    if (leftFace && rightFace && forehead && chin) {
      const faceWidth = distanceBetween(leftFace, rightFace);
      const faceHeight = distanceBetween(forehead, chin);
      context.save();
      context.beginPath();
      context.ellipse((leftFace.x + rightFace.x) / 2, forehead.y + faceHeight * .48, faceWidth * .84, faceHeight * 1.32, 0, 0, Math.PI * 2);
      context.clip();
      drawOriginal();
      context.restore();
    }
    return;
  }
  drawOriginal();
}

function drawCuteFaceEffect(pipeline, faceLandmarks) {
  const { context, canvas, filter } = pipeline;
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  drawCallSource(pipeline, faceLandmarks);
  if (filter === 'none') return;
  if (!faceLandmarks) {
    drawFallbackFaceEffect(pipeline);
    return;
  }

  const leftFace = landmarkPoint(faceLandmarks, 234, width, height);
  const rightFace = landmarkPoint(faceLandmarks, 454, width, height);
  const forehead = landmarkPoint(faceLandmarks, 10, width, height);
  const chin = landmarkPoint(faceLandmarks, 152, width, height);
  const leftCheek = landmarkPoint(faceLandmarks, 205, width, height);
  const rightCheek = landmarkPoint(faceLandmarks, 425, width, height);
  const leftEye = landmarkPoint(faceLandmarks, 33, width, height);
  const rightEye = landmarkPoint(faceLandmarks, 263, width, height);
  const mouth = landmarkPoint(faceLandmarks, 13, width, height);
  const faceWidth = distanceBetween(leftFace, rightFace);
  const faceHeight = distanceBetween(forehead, chin);
  if (!forehead || !faceWidth || !faceHeight) {
    drawFallbackFaceEffect(pipeline);
    return;
  }

  if (filter === 'bunny') {
    const earSize = Math.max(46, faceWidth * .28);
    context.font = `${earSize}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('🐰', forehead.x, forehead.y - faceHeight * .23);
    drawHeart(context, leftCheek?.x || forehead.x - faceWidth * .35, leftCheek?.y || forehead.y + faceHeight * .13, faceWidth * .09, '#ff75b3');
    drawHeart(context, rightCheek?.x || forehead.x + faceWidth * .35, rightCheek?.y || forehead.y + faceHeight * .13, faceWidth * .09, '#ff75b3');
  } else if (filter === 'hearts') {
    drawHeart(context, forehead.x - faceWidth * .37, forehead.y - faceHeight * .08, faceWidth * .14, '#ff5c9c');
    drawHeart(context, forehead.x + faceWidth * .37, forehead.y - faceHeight * .22, faceWidth * .1, '#ff9cc5');
    drawHeart(context, forehead.x, forehead.y - faceHeight * .38, faceWidth * .08, '#fff');
  } else if (filter === 'soft') {
    context.fillStyle = 'rgba(255, 174, 207, .12)';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(255, 255, 255, .6)';
    context.lineWidth = Math.max(2, faceWidth * .015);
    context.beginPath();
    context.arc(forehead.x, forehead.y + faceHeight * .08, faceWidth * .52, Math.PI * 1.07, Math.PI * 1.93);
    context.stroke();
  } else if (filter === 'rainbow') {
    const radius = faceWidth * .52;
    const colors = ['#ff83ad', '#ffc778', '#fff28a', '#9ee6bd', '#9fc9ff'];
    colors.forEach((color, index) => {
      context.strokeStyle = color;
      context.lineWidth = Math.max(3, faceWidth * .025);
      context.beginPath();
      context.arc(forehead.x, forehead.y + faceHeight * .15, radius - index * context.lineWidth * 1.3, Math.PI * 1.08, Math.PI * 1.92);
      context.stroke();
    });
    drawHeart(context, forehead.x, forehead.y - faceHeight * .43, faceWidth * .08, '#fff');
  } else if (filter === 'flower') {
    const flowerSize = Math.max(25, faceWidth * .15);
    context.font = `${flowerSize}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('🌼', forehead.x - faceWidth * .38, forehead.y - faceHeight * .12);
    context.fillText('🌸', forehead.x, forehead.y - faceHeight * .34);
    context.fillText('🌼', forehead.x + faceWidth * .38, forehead.y - faceHeight * .12);
  } else if (filter === 'crown') {
    const crownSize = Math.max(38, faceWidth * .28);
    context.font = `${crownSize}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('👑', forehead.x, forehead.y - faceHeight * .28);
    drawHeart(context, forehead.x - faceWidth * .39, forehead.y - faceHeight * .03, faceWidth * .07, '#ffe48b');
    drawHeart(context, forehead.x + faceWidth * .39, forehead.y - faceHeight * .03, faceWidth * .07, '#ffe48b');
  } else if (filter === 'blush') {
    context.fillStyle = 'rgba(255, 94, 145, .34)';
    [leftCheek, rightCheek].forEach((cheek) => {
      if (!cheek) return;
      context.beginPath();
      context.ellipse(cheek.x, cheek.y, faceWidth * .12, faceHeight * .045, 0, 0, Math.PI * 2);
      context.fill();
    });
    context.font = `${Math.max(22, faceWidth * .11)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    context.textAlign = 'center';
    context.fillText('✨', forehead.x, forehead.y - faceHeight * .28);
  } else if (filter === 'cat') {
    drawEmoji(context, '🐱', forehead.x, forehead.y - faceHeight * .22, Math.max(44, faceWidth * .28));
    drawEmoji(context, '💗', leftCheek?.x, leftCheek?.y, Math.max(18, faceWidth * .1));
    drawEmoji(context, '💗', rightCheek?.x, rightCheek?.y, Math.max(18, faceWidth * .1));
  } else if (filter === 'puppy') {
    drawEmoji(context, '🐶', forehead.x, forehead.y - faceHeight * .18, Math.max(42, faceWidth * .26));
    drawEmoji(context, '🦴', forehead.x + faceWidth * .4, forehead.y + faceHeight * .05, Math.max(20, faceWidth * .12));
  } else if (filter === 'glasses') {
    drawGlasses(context, leftEye, rightEye, faceWidth, faceHeight, '#433b72');
    drawEmoji(context, '✨', forehead.x, forehead.y - faceHeight * .3, Math.max(20, faceWidth * .1));
  } else if (filter === 'freckles') {
    drawFreckles(context, leftCheek, faceWidth, faceHeight);
    drawFreckles(context, rightCheek, faceWidth, faceHeight);
    drawEmoji(context, '🌼', forehead.x, forehead.y - faceHeight * .32, Math.max(24, faceWidth * .14));
  } else if (filter === 'butterfly') {
    drawEmoji(context, '🦋', forehead.x - faceWidth * .38, forehead.y - faceHeight * .18, Math.max(26, faceWidth * .16));
    drawEmoji(context, '🦋', forehead.x + faceWidth * .38, forehead.y - faceHeight * .08, Math.max(22, faceWidth * .14));
    drawHeart(context, forehead.x, forehead.y - faceHeight * .37, faceWidth * .08, '#a9e9ff');
  } else if (filter === 'kiss') {
    drawEmoji(context, '💋', mouth?.x || forehead.x, mouth?.y || forehead.y + faceHeight * .25, Math.max(30, faceWidth * .17));
    drawEmoji(context, '💗', forehead.x + faceWidth * .32, forehead.y - faceHeight * .23, Math.max(22, faceWidth * .12));
  } else if (filter === 'star') {
    drawEmoji(context, '✨', forehead.x - faceWidth * .4, forehead.y - faceHeight * .12, Math.max(24, faceWidth * .14));
    drawEmoji(context, '⭐', forehead.x, forehead.y - faceHeight * .4, Math.max(28, faceWidth * .16));
    drawEmoji(context, '✨', forehead.x + faceWidth * .4, forehead.y - faceHeight * .16, Math.max(20, faceWidth * .12));
  } else if (filter === 'devil') {
    drawEmoji(context, '😈', forehead.x, forehead.y - faceHeight * .2, Math.max(42, faceWidth * .25));
    drawEmoji(context, '🔥', leftCheek?.x, leftCheek?.y, Math.max(20, faceWidth * .11));
    drawEmoji(context, '🔥', rightCheek?.x, rightCheek?.y, Math.max(20, faceWidth * .11));
  }
}

function renderFaceFilterFrame(pipeline, timestamp) {
  if (activeFilterPipeline !== pipeline) return;
  const { sourceVideo, faceLandmarker } = pipeline;
  if (sourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && sourceVideo.videoWidth) {
    let result = null;
    if (faceLandmarker && timestamp - pipeline.lastInferenceAt > 55 && sourceVideo.currentTime !== pipeline.lastVideoTime) {
      result = faceLandmarker.detectForVideo(sourceVideo, timestamp);
      pipeline.lastInferenceAt = timestamp;
      pipeline.lastVideoTime = sourceVideo.currentTime;
      pipeline.faceLandmarks = result.faceLandmarks?.[0] || null;
    }
    drawCuteFaceEffect(pipeline, pipeline.faceLandmarks);
  }
  pipeline.animationFrame = requestAnimationFrame(renderFaceFilterFrame);
}

async function startFaceFilterPipeline(role, options = {}) {
  const elements = callElements(role);
  const sourceStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true });
  const mediaPrefs = getCallMediaPrefs(role);
  sourceStream.getVideoTracks().forEach((track) => { track.enabled = mediaPrefs.camera; });
  sourceStream.getAudioTracks().forEach((track) => { track.enabled = mediaPrefs.microphone; });
  const sourceVideo = document.createElement('video');
  sourceVideo.muted = true;
  sourceVideo.playsInline = true;
  sourceVideo.srcObject = sourceStream;
  await sourceVideo.play();
  await new Promise((resolve) => {
    if (sourceVideo.videoWidth) resolve();
    else sourceVideo.addEventListener('loadedmetadata', resolve, { once: true });
  });

  const canvas = document.createElement('canvas');
  canvas.width = sourceVideo.videoWidth;
  canvas.height = sourceVideo.videoHeight;
  const context = canvas.getContext('2d', { alpha: false });
  const canvasStream = typeof canvas.captureStream === 'function' ? canvas.captureStream(24) : null;
  const pipeline = {
    role,
    sourceStream,
    sourceVideo,
    canvas,
    context,
    canvasStream,
    filter: 'none',
    facingMode: 'user',
    backgroundMode: 'none',
    backgroundPreset: 'none',
    colorFilter: 'none',
    editEnabled: false,
    faceLandmarks: null,
    lastInferenceAt: 0,
    lastVideoTime: -1,
    faceLandmarker: null,
    animationFrame: null,
    localVideoTrack: null,
    localAudioTrack: null
  };
  activeFilterPipeline = pipeline;
  const loadModel = async () => {
    try {
      if (!canvasStream) throw new Error('Thiết bị chưa hỗ trợ xuất video filter từ canvas.');
      pipeline.faceLandmarker = await loadFaceLandmarker();
      if (activeFilterPipeline === pipeline) elements.stage.classList.add('has-face-filter');
    } catch (error) {
      console.warn('Không tải được face filter, dùng camera nguyên bản:', error.message);
      if (activeFilterPipeline === pipeline && !elements.section.hidden) {
        setCallStatus(role, 'Filter khuôn mặt đang tải chậm, cuộc gọi vẫn tiếp tục nha.');
      }
    }
  };
  if (options.deferFaceModel) loadModel();
  else await loadModel();
  pipeline.localVideoTrack = canvasStream
    ? new LocalVideoTrack(canvasStream.getVideoTracks()[0], { name: 'cute-face-filter' })
    : new LocalVideoTrack(sourceStream.getVideoTracks()[0], { name: 'camera' });
  pipeline.localAudioTrack = new LocalAudioTrack(sourceStream.getAudioTracks()[0], { name: 'microphone' });
  elements.stage.classList.toggle('has-face-filter', Boolean(pipeline.faceLandmarker && canvasStream));
  pipeline.animationFrame = requestAnimationFrame(renderFaceFilterFrame);
  return pipeline;
}

function stopFaceFilterPipeline() {
  if (!activeFilterPipeline) return;
  const pipeline = activeFilterPipeline;
  if (pipeline.animationFrame) cancelAnimationFrame(pipeline.animationFrame);
  pipeline.sourceStream?.getTracks().forEach((track) => track.stop());
  pipeline.canvasStream?.getTracks().forEach((track) => track.stop());
  pipeline.sourceVideo.srcObject = null;
  callElements(pipeline.role).stage.classList.remove('has-face-filter');
  activeFilterPipeline = null;
}

function ensureCallTile(role, identity, name) {
  const elements = callElements(role);
  let tile = [...elements.videos.querySelectorAll('.call-tile')].find((item) => item.dataset.identity === identity);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'call-tile';
    tile.dataset.identity = identity;
    tile.innerHTML = `<span class="call-participant-name">${escapeHtml(name || identity)}</span>`;
    elements.videos.appendChild(tile);
  }
  return tile;
}

function attachCallTrack(role, track, participant) {
  const tile = ensureCallTile(role, participant.identity, participant.name || participant.identity);
  const isLocal = participant.identity === (role === 'admin' ? 'anh' : 'vy');
  tile.classList.toggle('is-local-preview', isLocal);
  tile.classList.toggle('is-selfie-preview', isLocal && (activeFilterPipeline?.facingMode || 'user') === 'user');
  callElements(role).videos.classList.toggle('has-remote', [...callElements(role).videos.querySelectorAll('.call-tile')].some((item) => !item.classList.contains('is-local-preview')));
  if (track.kind === Track.Kind.Video) {
    tile.querySelectorAll('video').forEach((element) => element.remove());
    const video = track.attach();
    video.className = 'call-video';
    video.autoplay = true;
    video.playsInline = true;
    tile.prepend(video);
  } else if (track.kind === Track.Kind.Audio) {
    tile.querySelectorAll('audio').forEach((element) => element.remove());
    const audio = track.attach();
    audio.autoplay = true;
    audio.muted = getCallUiState(role).speakerOn === false;
    audio.dataset.callAudio = 'true';
    audio.setAttribute('aria-label', `Âm thanh của ${participant.name || participant.identity}`);
    tile.appendChild(audio);
  }
}

function removeCallTrack(track) {
  track.detach().forEach((element) => element.remove());
}

function updateCallStatus(role) {
  if (!livekitRoom || activeCallRole !== role) return;
  const remoteCount = livekitRoom.remoteParticipants.size;
  if (remoteCount) {
    startCallUiTimer(role);
    showCallControls(role, true);
    setCallStatus(role, 'Đã kết nối với người thương 💗');
  } else {
    setCallUiState(role, 'connecting');
    setCallStatus(role, 'Đang chờ người kia tham gia phòng…');
  }
}

function friendlyCallError(error) {
  const message = String(error?.message || '');
  if (/permission|denied|notallowed|NotAllowedError/i.test(message)) return 'Bạn hãy cho phép camera và microphone trong cài đặt trình duyệt rồi thử lại nha.';
  if (/token|401|unauthor/i.test(message)) return 'Phiên gọi đã hết hạn, hãy tải lại trang rồi gọi lại nha.';
  if (/livekit|serverUrl|participantToken/i.test(message)) return 'Phòng gọi hiện chưa sẵn sàng, bạn thử lại sau một chút nha.';
  if (/network|fetch|failed to fetch/i.test(message)) return 'Mạng đang không ổn định, kiểm tra kết nối rồi thử lại nha.';
  return message && message.length < 140 ? message : 'Chưa mở được cuộc gọi. Bạn thử lại nha.';
}

async function joinLiveKitCall(role = 'vy', announce = false, callType = 'video') {
  const elements = callElements(role);
  if (!elements.status) return;
  if (livekitRoom) await leaveLiveKitCall();
  const previewPipeline = callType === 'video' && activeFilterPipeline?.role === role ? activeFilterPipeline : null;
  activeCallType = callType;
  getCallUiState(role).callType = callType;
  openCallOverlay(role);
  callElements(role).lobby.hidden = true;
  setCallUiState(role, 'connecting');
  elements.start.disabled = true;
  elements.join.disabled = true;
  setCallStatus(role, callType === 'voice' ? 'Đang gọi thoại cho người thương…' : 'Đang gọi video cho người thương…');
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (role === 'admin') {
      const token = localStorage.getItem(ADMIN_TOKEN_KEY);
      if (!token) throw new Error('Anh cần đăng nhập góc của anh trước nha.');
      headers.Authorization = `Bearer ${token}`;
    }
    const tokenResponse = await fetch('/api/livekit/token', {
      method: 'POST',
      headers,
      body: JSON.stringify({ role, announce, callType })
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (tokenResponse.status === 401 && role === 'admin') {
      handleAdminSessionExpired();
      return;
    }
    if (!tokenResponse.ok) throw new Error(tokenData.error || 'Chưa mở được phòng video.');

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { resolution: VideoPresets.h720.resolution }
    });
    livekitRoom = room;
    activeCallRole = role;
    elements.videos.innerHTML = '';
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => attachCallTrack(role, track, participant));
    room.on(RoomEvent.TrackUnsubscribed, (track) => removeCallTrack(track));
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      const tile = [...elements.videos.querySelectorAll('.call-tile')].find((item) => item.dataset.identity === participant.identity);
      if (tile) tile.remove();
      elements.videos.classList.toggle('has-remote', [...elements.videos.querySelectorAll('.call-tile')].some((item) => !item.classList.contains('is-local-preview')));
      updateCallStatus(role);
    });
    room.on(RoomEvent.ParticipantConnected, () => updateCallStatus(role));
    room.on(RoomEvent.Reconnecting, () => {
      elements.section.classList.add('is-reconnecting');
      showCallControls(role, true);
      setCallStatus(role, 'Mạng đang chập chờn, đang kết nối lại…');
    });
    room.on(RoomEvent.Reconnected, () => {
      elements.section.classList.remove('is-reconnecting');
      setCallStatus(role, livekitRoom?.remoteParticipants.size ? 'Đã kết nối lại với người thương 💗' : 'Đã kết nối lại, đang chờ người kia…');
      updateCallStatus(role);
    });
    room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
      if (participant?.identity !== (role === 'admin' ? 'anh' : 'vy')) return;
      if (quality === 'poor' || quality === 'lost') setCallStatus(role, 'Mạng yếu, hình ảnh có thể bị trễ một chút nha.');
    });
    room.on(RoomEvent.DataReceived, (payload) => {
      try {
        const message = JSON.parse(new TextDecoder().decode(payload));
        if (message.type === 'call-reaction' && message.emoji) showCallReaction(role, message.emoji);
      } catch { /* ignore non-app call data */ }
    });
    room.on(RoomEvent.Disconnected, () => {
      if (livekitRoom !== room) return;
      sendCallHistoryMessage(role, 'ended').catch(() => {});
      livekitRoom = null;
      activeCallRole = null;
      stopCallUiTimer(role);
      setCallUiState(role, 'ended');
      setCallControls(role, false);
      setCallStatus(role, 'Cuộc gọi đã kết thúc.');
    });

    await room.connect(tokenData.serverUrl, tokenData.participantToken);
    // Mở quyền điều khiển ngay sau khi vào phòng; model face filter có thể tải nền khá lâu.
    setCallControls(role, true);
    if (callType === 'video') {
      const filterPipeline = previewPipeline || await startFaceFilterPipeline(role);
      // Hiện preview ngay khi camera sẵn sàng, để màn hình "Đang gọi…" có hình nền giống giao diện gọi hiện đại.
      elements.videos.innerHTML = '';
      attachCallTrack(role, filterPipeline.localVideoTrack, room.localParticipant);
      await room.localParticipant.publishTrack(filterPipeline.localAudioTrack, { source: Track.Source.Microphone });
      await room.localParticipant.publishTrack(filterPipeline.localVideoTrack, { source: Track.Source.Camera });
    } else {
      await room.localParticipant.setMicrophoneEnabled(true);
    }
    room.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((publication) => {
        if (publication.track) attachCallTrack(role, publication.track, participant);
      });
    });
    setCallControls(role, true);
    updateCallStatus(role);
  } catch (error) {
    stopFaceFilterPipeline();
    if (livekitRoom) {
      await livekitRoom.disconnect().catch(() => {});
      livekitRoom = null;
      activeCallRole = null;
    }
    setCallControls(role, false);
    setCallStatus(role, friendlyCallError(error));
  }
}

async function leaveLiveKitCall() {
  const role = activeCallRole;
  if (role) await sendCallHistoryMessage(role, 'ended');
  stopFaceFilterPipeline();
  if (livekitRoom) await livekitRoom.disconnect();
  livekitRoom = null;
  activeCallRole = null;
  if (role) {
    setCallUiState(role, 'ended');
    const elements = callElements(role);
    elements.videos.innerHTML = '';
    setCallControls(role, false);
    setCallStatus(role, 'Đã rời cuộc gọi.');
    closeCallOverlay(role);
  }
}

async function toggleCallCamera(role) {
  const pipeline = activeFilterPipeline?.role === role ? activeFilterPipeline : null;
  const sourceTrack = pipeline?.sourceStream?.getVideoTracks?.()[0];
  if (sourceTrack) {
    sourceTrack.enabled = !sourceTrack.enabled;
    saveCallMediaPref(role, 'camera', sourceTrack.enabled);
    callElements(role).camera.textContent = sourceTrack.enabled ? 'Tắt camera' : 'Bật camera';
    updateCallLobbyPermissions(role);
    return;
  }
  if (!livekitRoom || activeCallRole !== role) return;
  const enabled = !livekitRoom.localParticipant.isCameraEnabled;
  await livekitRoom.localParticipant.setCameraEnabled(enabled);
  saveCallMediaPref(role, 'camera', enabled);
  callElements(role).camera.textContent = enabled ? 'Tắt camera' : 'Bật camera';
}

async function toggleCallMicrophone(role) {
  const pipeline = activeFilterPipeline?.role === role ? activeFilterPipeline : null;
  const sourceTrack = pipeline?.sourceStream?.getAudioTracks?.()[0];
  if (sourceTrack) {
    sourceTrack.enabled = !sourceTrack.enabled;
    saveCallMediaPref(role, 'microphone', sourceTrack.enabled);
    callElements(role).microphone.textContent = sourceTrack.enabled ? 'Tắt mic' : 'Bật mic';
    updateCallLobbyPermissions(role);
    return;
  }
  if (!livekitRoom || activeCallRole !== role) return;
  const enabled = !livekitRoom.localParticipant.isMicrophoneEnabled;
  await livekitRoom.localParticipant.setMicrophoneEnabled(enabled);
  saveCallMediaPref(role, 'microphone', enabled);
  callElements(role).microphone.textContent = enabled ? 'Tắt mic' : 'Bật mic';
}

async function switchCallCamera(role) {
  const pipeline = activeFilterPipeline?.role === role ? activeFilterPipeline : null;
  const track = pipeline?.sourceStream?.getVideoTracks?.()[0];
  if (!track) { setCallStatus(role, 'Cuộc gọi này chưa bật camera để đổi nha.'); return; }
  const current = track.getSettings().facingMode || pipeline.facingMode || 'user';
  const next = current === 'environment' ? 'user' : 'environment';
  try {
    await track.applyConstraints({ facingMode: { ideal: next } });
    pipeline.facingMode = next;
    const tile = callElements(role).videos.querySelector('.call-tile.is-local-preview');
    tile?.classList.toggle('is-selfie-preview', next === 'user');
    setCallStatus(role, next === 'user' ? 'Đã chuyển sang camera trước.' : 'Đã chuyển sang camera sau.');
  } catch (error) {
    setCallStatus(role, 'Thiết bị này không hỗ trợ đổi camera khi đang gọi.');
    console.warn('Không đổi được camera:', error.message);
  }
}

async function toggleCallScreenShare(role) {
  if (!livekitRoom || activeCallRole !== role || activeCallType === 'voice') return;
  const elements = callElements(role);
  const publication = livekitRoom.localParticipant.getTrackPublication(Track.Source.ScreenShare);
  const sharing = Boolean(publication?.track && !publication.isMuted);
  try {
    await livekitRoom.localParticipant.setScreenShareEnabled(!sharing);
    const button = elements.share;
    if (button) {
      button.classList.toggle('is-active', !sharing);
      button.setAttribute('aria-pressed', String(!sharing));
    }
    setCallStatus(role, !sharing ? 'Đã bật chia sẻ màn hình.' : 'Đã tắt chia sẻ màn hình.');
  } catch (error) {
    setCallStatus(role, 'Thiết bị chưa cho phép chia sẻ màn hình.');
    console.warn('Không chia sẻ được màn hình:', error.message);
  }
}

function toggleCallLayout(role) {
  const elements = callElements(role);
  const split = elements.videos.classList.toggle('is-split-layout');
  if (elements.layout) {
    elements.layout.classList.toggle('is-active', split);
    elements.layout.setAttribute('aria-pressed', String(split));
  }
  setCallStatus(role, split ? 'Đã bật bố cục chia đôi.' : 'Đã chuyển về video người kia toàn màn hình.');
}

function toggleCallSpeaker(role) {
  const state = getCallUiState(role);
  state.speakerOn = state.speakerOn !== false ? false : true;
  const elements = callElements(role);
  elements.stage?.querySelectorAll('audio').forEach((audio) => { audio.muted = !state.speakerOn; });
  if (elements.speaker) {
    elements.speaker.classList.toggle('is-active', state.speakerOn);
    elements.speaker.querySelector('span')?.replaceChildren(document.createTextNode(state.speakerOn ? '🔊' : '🔇'));
    elements.speaker.setAttribute('aria-pressed', String(state.speakerOn));
  }
  setCallStatus(role, state.speakerOn ? 'Đã bật loa.' : 'Đã tắt loa.');
}

async function loadMiniCallMessages(role) {
  const elements = callElements(role);
  const container = elements.miniChat?.querySelector('[data-call-mini-messages]');
  if (!container) return;
  try {
    const token = role === 'admin' ? localStorage.getItem(ADMIN_TOKEN_KEY) : '';
    const response = await fetch(`/api/chat/messages?role=${role}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Chưa tải được tin nhắn.');
    const messages = (data.messages || []).slice(-5);
    container.innerHTML = messages.length ? messages.map((message) => `<p class="${message.sender_role === role ? 'is-mine' : ''}">${escapeHtml(parseChatMessage(message.content).text || '📎')}</p>`).join('') : '<p class="is-empty">Chưa có tin nhắn gần đây.</p>';
    container.scrollTop = container.scrollHeight;
  } catch (error) {
    container.innerHTML = `<p class="is-empty">${escapeHtml(error.message)}</p>`;
  }
}

async function sendMiniCallMessage(role) {
  const elements = callElements(role);
  const input = elements.miniChat?.querySelector('input');
  const content = input?.value.trim();
  if (!content) return;
  const token = role === 'admin' ? localStorage.getItem(ADMIN_TOKEN_KEY) : '';
  try {
    const response = await fetch('/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ senderRole: role, content, imageDataUrl: '' })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Chưa gửi được tin nhắn.');
    input.value = '';
    await loadMiniCallMessages(role);
  } catch (error) {
    setCallStatus(role, error.message);
  }
}

async function toggleMiniCallChat(role, forceOpen = null) {
  const elements = callElements(role);
  if (!elements.miniChat) return;
  const open = forceOpen === null ? elements.miniChat.hidden : forceOpen;
  elements.miniChat.hidden = !open;
  elements.stage.classList.toggle('is-chat-open', open);
  if (open) await loadMiniCallMessages(role);
}

async function sendCallHistoryMessage(role, status = 'ended') {
  const state = getCallUiState(role);
  if (state.historySent) return;
  state.historySent = true;
  const duration = state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
  const token = role === 'admin' ? localStorage.getItem(ADMIN_TOKEN_KEY) : '';
  try {
    await fetch('/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ senderRole: role, content: `${CHAT_CALL_PREFIX}${JSON.stringify({ callType: state.callType || activeCallType, duration, status })}`, imageDataUrl: '' })
    });
    loadChatMessages(role, true).catch(() => {});
  } catch (error) {
    console.warn('Không lưu được lịch sử cuộc gọi:', error.message);
  }
}

function showCallReaction(role, emoji) {
  const stage = callElements(role).stage;
  if (!stage) return;
  const item = document.createElement('span');
  item.className = 'call-reaction-float';
  item.textContent = emoji;
  stage.appendChild(item);
  window.setTimeout(() => item.remove(), 1900);
}

async function sendCallReaction(role, emoji) {
  if (!livekitRoom || activeCallRole !== role) return;
  const state = getCallUiState(role);
  if (Date.now() < state.reactionCooldownUntil) return;
  state.reactionCooldownUntil = Date.now() + 700;
  showCallReaction(role, emoji);
  try { await livekitRoom.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: 'call-reaction', emoji })), { reliable: true }); } catch (error) { console.warn('Không gửi được reaction cuộc gọi:', error.message); }
}

function captureCallSnapshot(role) {
  const video = callElements(role).videos.querySelector('video');
  if (!video || !video.videoWidth) { setCallStatus(role, 'Chưa có hình ảnh để chụp nha.'); return; }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  const link = document.createElement('a');
  link.download = `lich-cua-vy-${Date.now()}.jpg`;
  link.href = canvas.toDataURL('image/jpeg', .92);
  link.click();
  setCallStatus(role, 'Đã lưu ảnh cuộc gọi vào máy rồi nha 📸');
}

function handleIncomingCallHint() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('call') !== '1') return;
  const role = params.get('admin') === '1' ? 'admin' : 'vy';
  const action = params.get('callAction');
  showIncomingCall(role, params.get('kind') === 'voice' ? 'voice' : 'video');
  window.history.replaceState({}, document.title, window.location.pathname);
  if (action === 'accept') window.setTimeout(() => acceptIncomingCall(role), 250);
  if (action === 'decline') window.setTimeout(() => declineIncomingCall(role), 250);
}

function acceptIncomingCall(role) {
  const callType = pendingIncomingCall?.role === role ? pendingIncomingCall.callType : 'video';
  stopIncomingCallAlert();
  pendingIncomingCall = null;
  joinLiveKitCall(role, false, callType);
}

function declineIncomingCall(role) {
  stopIncomingCallAlert();
  sendCallHistoryMessage(role, 'declined').catch(() => {});
  setCallUiState(role, 'declined');
  setCallStatus(role, 'Đã từ chối cuộc gọi.');
  closeCallOverlay(role);
}

function handleIncomingNotificationTarget() {
  const params = new URLSearchParams(window.location.search);
  const section = params.get('section');
  if (!section) return false;
  const selectorBySection = {
    calendar: '#calendarSection',
    food: '#foodSection',
    'vy-chat': '#vyChatSection',
    'admin-chat': '#adminChatSection',
    'food-requests': '#foodRequestList',
    'admin-calendar': '#adminScheduleSection'
  };
  const target = $(selectorBySection[section]);
  const adminTarget = section === 'admin-chat' || section === 'food-requests' || section === 'admin-calendar';
  const screen = adminTarget ? $('#adminScreen') : $('#appShell');
  if (!target || screen?.hidden) return false;
  window.setTimeout(() => {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.classList.add('notification-target');
    window.setTimeout(() => target.classList.remove('notification-target'), 1900);
  }, 80);
  window.history.replaceState({}, document.title, window.location.pathname);
  return true;
}

function handleNotificationNavigation(url) {
  const targetUrl = new URL(url || '/', window.location.origin);
  if (targetUrl.origin !== window.location.origin) return;
  window.history.replaceState({}, document.title, `${targetUrl.pathname}${targetUrl.search}`);
  if (targetUrl.searchParams.get('admin') === '1' && localStorage.getItem(ADMIN_TOKEN_KEY) && $('#adminScreen').hidden) {
    showAdminScreen();
  }
  handleIncomingCallHint();
  handleIncomingNotificationTarget();
}

function bindNotificationNavigation() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'notification-navigation') handleNotificationNavigation(event.data.url);
    if (event.data?.type === 'incoming-call') {
      const role = event.data.role === 'admin' ? 'admin' : 'vy';
      if (role === 'admin' && localStorage.getItem(ADMIN_TOKEN_KEY) && $('#adminScreen').hidden) showAdminScreen();
      showIncomingCall(role, event.data.callType === 'voice' ? 'voice' : 'video');
    }
  });
}

function showAdminScreen() {
  $('#loginScreen').hidden = true;
  $('#appShell').classList.remove('is-unlocked');
  $('#appShell').hidden = true;
  $('#adminScreen').hidden = false;
  updateAdminNotificationUi();
  renderAdminCalendar();
  startChatPolling('admin');
  loadFoodRequests();
  loadAdminSchedule();
  loadMood('admin');
}

function leaveAdminScreen() {
  stopChatPolling();
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  $('#adminScreen').hidden = true;
  $('#appShell').hidden = false;
  $('#loginScreen').hidden = false;
  $('#adminLoginPanel').hidden = true;
  $('#loginForm').hidden = false;
}

async function handleAdminLogin(event) {
  event.preventDefault();
  const error = $('#adminLoginError');
  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('#adminUsername').value.trim(), password: $('#adminPassword').value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Đăng nhập chưa thành công.');
    localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
    error.textContent = '';
    showAdminScreen();
    handleIncomingNotificationTarget();
  } catch (loginError) {
    error.textContent = loginError.message;
  }
}

async function enableAdminNotifications() {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (!token) return;
  try {
    await subscribeToWebPush('admin', token);
    localStorage.setItem(ADMIN_PUSH_ENABLED_KEY, 'true');
    $('#enableAdminNotifications').textContent = 'Đã bật thông báo nhận request';
    showToast('Từ giờ anh sẽ nhận thông báo khi Vy chọn món 💌');
  } catch (error) {
    showToast(error.message || 'Chưa bật được thông báo nhận request.');
  }
}

async function updateAdminNotificationUi() {
  const button = $('#enableAdminNotifications');
  if (!button) return;
  let enabled = localStorage.getItem(ADMIN_PUSH_ENABLED_KEY) === 'true';
  if (!enabled && 'serviceWorker' in navigator && 'PushManager' in window) {
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      enabled = Boolean(subscription);
      if (enabled) localStorage.setItem(ADMIN_PUSH_ENABLED_KEY, 'true');
    } catch {
      // Hiển thị nút bật lại nếu trình duyệt không đọc được đăng ký cũ.
    }
  }
  button.textContent = enabled ? 'Đã bật thông báo nhận request' : 'Bật thông báo nhận request';
}

async function loadFoodRequests() {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (!token) return;
  const list = $('#foodRequestList');
  list.innerHTML = '<p class="empty-request">Đang tải các món Vy muốn ăn...</p>';
  try {
    const response = await fetch('/api/food-requests', { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (response.status === 401) {
      handleAdminSessionExpired();
      return;
    }
    if (!response.ok) throw new Error(data.error || 'Chưa tải được request.');
    const displayRequests = data.requests.map((request) => ({
      ...request,
      category: escapeHtml(request.category),
      item: escapeHtml(request.item),
      note: escapeHtml(request.note),
      response: escapeHtml(request.response)
    }));
    list.innerHTML = displayRequests.length ? displayRequests.map((request) => `
      <article class="food-request-item ${request.status}">
        <div><span class="request-category">${request.category}</span><h3>${request.item}</h3>${request.note ? `<p>Ghi chú: ${request.note}</p>` : ''}<small>${new Date(request.created_at).toLocaleString('vi-VN')}</small></div>
        <select class="request-status" data-request-id="${request.id}" aria-label="Trạng thái request">
          <option value="pending" ${request.status === 'pending' ? 'selected' : ''}>Đang chờ mua</option>
          <option value="bought" ${request.status === 'bought' ? 'selected' : ''}>Anh mua rồi</option>
          <option value="done" ${request.status === 'done' ? 'selected' : ''}>Đã gửi Vy</option>
        </select>
      </article>
    `).join('') : '<p class="empty-request">Chưa có món nào, chờ Vy chọn món thật ngon nha 💗</p>';
    $$('.request-status').forEach((select) => select.addEventListener('change', () => updateFoodRequest(select.dataset.requestId, select.value)));
    data.requests.forEach((request) => {
      const select = document.querySelector(`.request-status[data-request-id="${request.id}"]`);
      if (!select) return;
      const panel = document.createElement('div');
      panel.className = 'response-panel';
      panel.innerHTML = `
        ${request.response ? `<p class="response-sent">Đã phản hồi: ${escapeHtml(request.response)}</p>` : ''}
        <div class="quick-responses">
          <button type="button" class="quick-response" data-response-key="now">Mua bây giờ</button>
          <button type="button" class="quick-response" data-response-key="later">Mua sau</button>
          <button type="button" class="quick-response" data-response-key="evening">Tối đi làm về mua</button>
        </div>
        <textarea class="response-note" id="response-note-${request.id}" rows="2" placeholder="Anh ghi chú thêm cho Vy ở đây..."></textarea>
        <button type="button" class="button button-primary response-send" data-request-id="${request.id}">Gửi phản hồi cho Vy 💌</button>
      `;
      select.parentElement.appendChild(panel);
      panel.querySelectorAll('.quick-response').forEach((button) => button.addEventListener('click', () => {
        const quick = QUICK_RESPONSES[button.dataset.responseKey];
        sendFoodResponse(request.id, quick.text, quick.status);
      }));
      panel.querySelector('.response-send').addEventListener('click', () => {
        const note = panel.querySelector('.response-note').value.trim();
        sendFoodResponse(request.id, note, 'pending');
      });
    });
  } catch (error) {
    list.innerHTML = `<p class="empty-request">${error.message}</p>`;
  }
}

async function loadSharedSchedule() {
  try {
    const response = await fetch('/api/schedule');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Chưa tải được lịch dùng chung.');
    if (data.hasStoredEntries) {
      state.schedule = { ...defaultSchedule, ...(data.schedule || {}) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.schedule));
      renderOverview();
      renderCalendar();
    } else {
      await syncScheduleToServer();
    }
  } catch (error) {
    console.warn('Không tải được lịch dùng chung:', error.message);
  }
}

function renderAdminCalendar() {
  const grid = $('#adminCalendarGrid');
  if (!grid) return;
  const year = state.adminVisibleMonth.getFullYear();
  const month = state.adminVisibleMonth.getMonth();
  $('#adminMonthLabel').textContent = new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric' }).format(state.adminVisibleMonth);
  grid.innerHTML = '';
  const firstDay = new Date(year, month, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = localDateKey(todayAtMidnight());
  const schedule = state.adminSchedule || defaultSchedule;
  for (let index = 0; index < offset; index += 1) {
    const cell = document.createElement('div');
    cell.className = 'day-cell empty';
    grid.appendChild(cell);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const key = localDateKey(date);
    const code = schedule[key];
    const info = codeInfo(code);
    const cell = document.createElement('div');
    cell.className = `day-cell${key === todayKey ? ' is-today' : ''}`;
    cell.setAttribute('aria-label', `${displayDate(date)}: ${info.title}`);
    cell.innerHTML = `${key === todayKey ? '<span class="today-label">Hôm nay</span>' : ''}<span class="day-number">${day}</span>${code ? `<span class="shift-chip ${info.className}">${escapeHtml(code)}</span>` : ''}`;
    grid.appendChild(cell);
  }
  const totalCells = offset + daysInMonth;
  const trailing = (7 - (totalCells % 7)) % 7;
  for (let index = 0; index < trailing; index += 1) {
    const cell = document.createElement('div');
    cell.className = 'day-cell empty';
    grid.appendChild(cell);
  }
}

async function loadAdminSchedule() {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (!token) return;
  const status = $('#adminScheduleStatus');
  if (status) status.textContent = 'Đang tải lịch của Vy...';
  try {
    const response = await fetch('/api/schedule?role=admin', { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (response.status === 401) {
      handleAdminSessionExpired();
      return;
    }
    if (!response.ok) throw new Error(data.error || 'Chưa tải được lịch của Vy.');
    state.adminSchedule = { ...defaultSchedule, ...(data.schedule || {}) };
    renderAdminCalendar();
    if (status) status.textContent = data.updatedAt ? `Cập nhật lần cuối ${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.updatedAt))}` : 'Lịch mặc định của Vy';
  } catch (error) {
    if (status) status.textContent = error.message;
  }
}

async function updateFoodRequest(id, status) {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  await fetch(`/api/food-requests/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status })
  });
  loadFoodRequests();
}

async function sendFoodResponse(id, responseText, status = 'pending') {
  if (!responseText) {
    showToast('Anh hãy ghi lời nhắn cho Vy trước nha 💕');
    return;
  }
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  try {
    const response = await fetch(`/api/food-requests/${id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ response: responseText, status })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Chưa gửi được phản hồi cho Vy.');
    showToast('Vy sẽ nhận được phản hồi của anh ngay 💌');
    loadFoodRequests();
  } catch (error) {
    showToast(error.message);
  }
}

function applyAvatarImage() {
  const imageUrl = AVATAR_IMAGE_URL.trim();
  if (!/^https:\/\//i.test(imageUrl)) return;

  $$('.avatar-image').forEach((image) => {
    const fallback = image.previousElementSibling;
    image.addEventListener('load', () => {
      image.hidden = false;
      if (fallback) fallback.hidden = true;
    }, { once: true });
    image.src = imageUrl;
  });
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function displayDate(date, options = { day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('vi-VN', options).format(date);
}

function codeInfo(code) {
  if (code === 'D') return { title: 'Ca ngày · 12 tiếng', subtitle: '07:30 — 20:00', className: 'day', note: '☀️ Chúc nàng một ca ngày thật suôn sẻ nha!' };
  if (code === 'N') return { title: 'Ca đêm · 12 tiếng', subtitle: '19:30 — 07:30 hôm sau', className: 'night', note: '🌙 Ca đêm cố lên, tan ca nhớ về nghỉ ngơi nhé!' };
  if (code === '18') return { title: 'Được nghỉ', subtitle: 'Một ngày để nạp lại năng lượng', className: 'off', note: '🧸 Hôm nay nàng được nghỉ rồi, ngủ thật ngon nha!' };
  if (code === '9') return { title: 'Được nghỉ', subtitle: 'Một ngày để nạp lại năng lượng', className: 'off', note: '🌷 Nghỉ ngơi vui vẻ nhé, Vy xứng đáng được yêu chiều!' };
  return { title: 'Lịch điều chỉnh', subtitle: 'Kiểm tra lại với điều dưỡng trưởng', className: 'adjusted', note: '💌 Nhớ kiểm tra lại lịch chi tiết nha!' };
}

function shiftWindow(date, code) {
  const start = new Date(date);
  const end = new Date(date);
  if (code === 'D') {
    start.setHours(7, 30, 0, 0);
    end.setHours(20, 0, 0, 0);
  } else if (code === 'N') {
    start.setHours(19, 30, 0, 0);
    end.setDate(end.getDate() + 1);
    end.setHours(7, 30, 0, 0);
  } else {
    return null;
  }
  return { start, end };
}

function getActiveShift(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayKey = localDateKey(today);
  const todayCode = state.schedule[todayKey];
  const todayWindow = shiftWindow(today, todayCode);
  if (todayWindow && now >= todayWindow.start && now < todayWindow.end) {
    return { code: todayCode, date: today, ...todayWindow };
  }

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayCode = state.schedule[localDateKey(yesterday)];
  const nightWindow = shiftWindow(yesterday, yesterdayCode);
  if (nightWindow && now >= nightWindow.start && now < nightWindow.end) {
    return { code: yesterdayCode, date: yesterday, ...nightWindow };
  }

  // Nếu người dùng nhập ca N theo ngày đang xem, vẫn nhận diện phần cuối ca
  // trước 07:30 để lời nhắc không bị trễ khi mở app sau nửa đêm.
  if (todayCode === 'N' && now.getHours() < 8) {
    const currentNight = shiftWindow(yesterday, 'N');
    return { code: todayCode, date: yesterday, ...currentNight };
  }
  return null;
}

function formatRemaining(milliseconds) {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} phút`;
  if (minutes === 0) return `${hours} tiếng`;
  return `${hours} tiếng ${minutes} phút`;
}

function renderLiveCountdown() {
  const countdown = $('#liveCountdown');
  const activeShift = getActiveShift(new Date());
  if (!activeShift) {
    countdown.hidden = true;
    return;
  }
  const remaining = activeShift.end.getTime() - Date.now();
  if (remaining <= 0) {
    countdown.hidden = true;
    return;
  }
  const destination = activeShift.code === 'N' ? 'về với anh iu' : 'tan ca về với anh iu';
  countdown.textContent = `Cố lên Vy, còn ${formatRemaining(remaining)} nữa là ${destination} rồi 💗`;
  countdown.hidden = false;
}

function todayAtMidnight() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function renderOverview() {
  const today = todayAtMidnight();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const todayCode = state.schedule[localDateKey(today)] || '—';
  const tomorrowCode = state.schedule[localDateKey(tomorrow)] || '—';
  renderShiftCard('today', today, todayCode);
  renderShiftCard('tomorrow', tomorrow, tomorrowCode);

  const hour = new Date().getHours();
  const greeting = hour < 11 ? 'Chào buổi sáng, Vy yêu 🌤️' : hour < 18 ? 'Chào buổi chiều, Vy yêu 🌼' : 'Chào buổi tối, Vy yêu 🌙';
  $('#welcomeTitle').textContent = greeting;
  $('#currentGreeting').textContent = 'Phan Thị Thảo Vy · số 6';
  $('#heroMessage').textContent = todayCode === 'D' || todayCode === 'N' ? 'Nàng nhớ giữ sức, làm việc vui vẻ và tan ca bình an để về với anh iu nhé.' : 'Hôm nay nàng có thể thong thả một chút, nhớ chăm sóc bản thân và nhớ anh iu nha.';
}

function renderShiftCard(prefix, date, code) {
  const info = codeInfo(code);
  $(`#${prefix}DateLabel`).textContent = displayDate(date, { day: 'numeric', month: 'short' });
  $(`#${prefix}Code`).textContent = code;
  $(`#${prefix}Title`).textContent = info.title;
  $(`#${prefix}Subtitle`).textContent = info.subtitle;
  $(`#${prefix}Note`).textContent = info.note;
  $(`#${prefix}Card`).classList.toggle('off-card', info.className === 'off');
}

function renderCalendar() {
  const year = state.visibleMonth.getFullYear();
  const month = state.visibleMonth.getMonth();
  $('#monthLabel').textContent = new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric' }).format(state.visibleMonth);
  const grid = $('#calendarGrid');
  grid.innerHTML = '';
  const firstDay = new Date(year, month, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = localDateKey(todayAtMidnight());
  const selectedKey = state.selectedDate;

  for (let index = 0; index < offset; index += 1) {
    const cell = document.createElement('div');
    cell.className = 'day-cell empty';
    grid.appendChild(cell);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const key = localDateKey(date);
    const code = state.schedule[key];
    const info = codeInfo(code);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = `day-cell${key === todayKey ? ' is-today' : ''}${key === selectedKey ? ' is-selected' : ''}`;
    cell.setAttribute('aria-label', `${displayDate(date)}: ${info.title}`);
    cell.innerHTML = `${key === todayKey ? '<span class="today-label">Hôm nay</span>' : ''}<span class="day-number">${day}</span>${code ? `<span class="shift-chip ${info.className}">${code}</span>` : ''}`;
    cell.addEventListener('click', () => openDayModal(key));
    grid.appendChild(cell);
  }
  const totalCells = offset + daysInMonth;
  const trailing = (7 - (totalCells % 7)) % 7;
  for (let index = 0; index < trailing; index += 1) {
    const cell = document.createElement('div');
    cell.className = 'day-cell empty';
    grid.appendChild(cell);
  }
}

function changeVisibleMonth(amount) {
  state.visibleMonth = new Date(state.visibleMonth.getFullYear(), state.visibleMonth.getMonth() + amount, 1);
  renderCalendar();
}

function bindCalendarSwipe() {
  const calendarCard = $('#calendarCard');
  if (!calendarCard) return;
  let startX = 0;
  let startY = 0;

  calendarCard.addEventListener('touchstart', (event) => {
    const touch = event.changedTouches[0];
    startX = touch.clientX;
    startY = touch.clientY;
  }, { passive: true });

  calendarCard.addEventListener('touchend', (event) => {
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    if (Math.abs(deltaX) < 55 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return;
    state.suppressCalendarClick = true;
    changeVisibleMonth(deltaX < 0 ? 1 : -1);
    window.setTimeout(() => { state.suppressCalendarClick = false; }, 350);
  }, { passive: true });
}

function openDayModal(key) {
  if (state.suppressCalendarClick) return;
  state.selectedDate = key;
  state.selectedCode = state.schedule[key] || '18';
  $('#modalDate').textContent = displayDate(parseDate(key), { weekday: 'long', day: 'numeric', month: 'long' });
  $('#modalTitle').textContent = `Lịch ngày ${parseDate(key).getDate()}`;
  $$('#shiftPicker button').forEach((button) => button.classList.toggle('active', button.dataset.code === state.selectedCode));
  $('#dayModal').hidden = false;
  renderCalendar();
}

function closeDayModal() {
  $('#dayModal').hidden = true;
  state.selectedDate = null;
  state.selectedCode = null;
  renderCalendar();
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function setAuthenticated(authenticated) {
  const appShell = $('#appShell');
  const loginScreen = $('#loginScreen');
  appShell.classList.toggle('is-unlocked', authenticated);
  loginScreen.hidden = authenticated;
  if (authenticated) {
    localStorage.setItem(AUTH_KEY, 'true');
    startChatPolling('vy');
  } else {
    localStorage.removeItem(AUTH_KEY);
    stopChatPolling();
  }
}

function handleLogin(event) {
  event.preventDefault();
  const username = $('#username').value.trim();
  const password = $('#password').value;
  const error = $('#loginError');
  if (username === DEMO_USERNAME && password === DEMO_PASSWORD) {
    error.textContent = '';
    setAuthenticated(true);
    renderOverview();
    renderCalendar();
    loadSharedSchedule();
    handleIncomingNotificationTarget();
    showToast('Đăng nhập thành công, chào Vy yêu 💗');
    return;
  }
  error.textContent = 'Tài khoản hoặc mật khẩu chưa đúng, thử lại nhé.';
  $('#password').select();
}

function handleLogout() {
  setAuthenticated(false);
  $('#loginForm').reset();
  $('#loginError').textContent = '';
  showToast('Đã đăng xuất khỏi lịch của Vy.');
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isHomeScreenApp() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function showIosInstallGuidance() {
  $('#reminderTitle').textContent = 'Cài app lên màn hình chính trước';
  $('#reminderDescription').textContent = 'Trong Safari: Chia sẻ → Thêm vào màn hình chính → mở app từ biểu tượng Lịch của Vy.';
  showToast('Vy hãy thêm app vào Màn hình chính rồi mở lại để bật thông báo nha 📱');
}

function reminderDescription(code) {
  if (code === 'D') return 'đi làm ca D · 07:30–20:00';
  if (code === 'N') return 'đi làm ca N · 19:30–07:30 hôm sau';
  if (code === '18' || code === '9') return 'được nghỉ';
  if (code === 'eAD') return 'lịch điều chỉnh · eAD';
  return 'chưa có lịch';
}

function icsEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n');
}

function icsLocalDate(date, hour) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(hour).padStart(2, '0');
  return `${year}${month}${day}T${hours}0000`;
}

function createCalendarEvent(uid, start, title, description) {
  const end = new Date(start.getTime() + 30 * 60000);
  return [
    'BEGIN:VEVENT',
    `UID:${uid}@lich-cua-vy`,
    `DTSTAMP:${icsLocalDate(new Date(), 0)}`,
    `DTSTART:${icsLocalDate(start, start.getHours())}`,
    `DTEND:${icsLocalDate(end, end.getHours())}`,
    `SUMMARY:${icsEscape(title)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Nhắc lịch của Vy',
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT'
  ].join('\r\n');
}

function exportCalendarFile() {
  const events = [];
  Object.keys(state.schedule).sort().forEach((key) => {
    const date = parseDate(key);
    const code = state.schedule[key];
    const description = reminderDescription(code);
    const todayStart = new Date(date);
    todayStart.setHours(6, 0, 0, 0);
    events.push(createCalendarEvent(`${key}-morning`, todayStart, 'Chào buổi sáng, Vy yêu', `Hôm nay ${description}. Chúc Vy một ngày thật vui vẻ và nhớ anh iu thật nhiều nhé 💗`));

    const noonStart = new Date(date);
    noonStart.setHours(12, 0, 0, 0);
    events.push(createCalendarEvent(`${key}-noon`, noonStart, 'Chúc em yêu buổi trưa vui vẻ', 'Giữa ngày rồi đó. Nhớ uống nước, ăn uống đầy đủ và giữ sức nha 💕'));

    const tomorrow = new Date(date);
    tomorrow.setDate(tomorrow.getDate() - 1);
    const tomorrowCode = state.schedule[localDateKey(date)];
    const tomorrowStart = new Date(tomorrow);
    tomorrowStart.setHours(20, 0, 0, 0);
    events.push(createCalendarEvent(`${key}-evening`, tomorrowStart, 'Chúc em yêu buổi tối thật dịu dàng', `Ngày mai ${description}. Ngủ ngon để mai luôn tràn đầy năng lượng nha 💞`));
  });
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lich Cua Vy//VI', 'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Lịch nhắc của Vy', 'X-WR-TIMEZONE:Asia/Ho_Chi_Minh',
    ...events, 'END:VCALENDAR'
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'lich-cua-vy-nhac-06h-12h-20h.ics';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast('Đã tạo lịch nhắc 06:00, 12:00 và 20:00. Hãy mở file bằng ứng dụng Lịch nhé 📅');
}

async function enableNotifications() {
  const nativeNotifications = await getNativeNotifications();
  if (nativeNotifications) {
    await scheduleNativeReminders(nativeNotifications);
    $('#notificationIcon').textContent = '♥';
    $('#reminderTitle').textContent = 'Nhắc lịch điện thoại đã bật';
    $('#reminderDescription').textContent = '';
    $('#enableNotification').textContent = 'Đã bật';
    showToast('Đã lập nhắc lịch trên điện thoại cho Vy rồi 💗');
    return;
  }
  if (isIosDevice() && !isHomeScreenApp()) {
    showIosInstallGuidance();
    return;
  }
  if (!('Notification' in window)) {
    if (isIosDevice()) showIosInstallGuidance();
    showToast('Trình duyệt này chưa hỗ trợ thông báo.');
    return;
  }
  try {
    await subscribeToWebPush();
    updateNotificationUi('granted');
    showToast('Đã bật lời nhắn 06:00, 12:00 và 20:00 cho Vy rồi 💗');
  } catch (error) {
    showToast(error.message || 'Chưa thể bật nhắc lịch. Vy thử lại sau nhé.');
  }
}

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const bytes = atob(base64);
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

async function subscribeToWebPush(role = 'vy', adminToken = '') {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Thiết bị này chưa hỗ trợ nhắc nền. Hãy mở app từ Màn hình chính trên iPhone.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Vy chưa cho phép thông báo. Hãy bật lại trong Cài đặt iPhone nhé.');
  }
  const keyResponse = await fetch('/api/push/public-key');
  if (!keyResponse.ok) {
    throw new Error('Hệ thống nhắc lịch chưa được cấu hình trên Railway.');
  }
  const { publicKey } = await keyResponse.json();
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }
  const headers = { 'Content-Type': 'application/json' };
  if (role === 'admin') headers.Authorization = `Bearer ${adminToken}`;
  const subscribeResponse = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers,
    body: JSON.stringify(role === 'admin' ? { subscription, role } : subscription)
  });
  if (!subscribeResponse.ok) throw new Error('Không lưu được thiết bị nhận nhắc. Vy thử lại nhé.');
}

async function getNativeNotifications() {
  if (!window.Capacitor) return null;
  nativeNotificationsPromise ||= import('@capacitor/local-notifications').then(async (module) => {
    const notifications = module.LocalNotifications;
    await notifications.addListener('localNotificationActionPerformed', (event) => {
      handleNotificationNavigation(event.notification?.extra?.url || '/?section=calendar');
    });
    return notifications;
  }).catch(() => null);
  return nativeNotificationsPromise;
}

function nativeReminderBody(moment, label, date) {
  const dateText = displayDate(date, { weekday: 'long', day: 'numeric', month: 'numeric' });
  if (moment === 'morning') return `Chào buổi sáng Vy yêu 🌷 Hôm nay ${dateText}: ${label}. Cố lên và nhớ giữ sức nhé 💗`;
  if (moment === 'noon') return `Chúc em yêu buổi trưa vui vẻ ☀️ Hôm nay ${label}. Nhớ uống nước và ăn uống đầy đủ nha 💕`;
  return `Chúc em yêu buổi tối thật dịu dàng 🌙 Ngày mai ${dateText}: ${label}. Ngủ ngon nha 💞`;
}

async function scheduleNativeReminders(localNotifications) {
  const permission = await localNotifications.requestPermissions();
  if (permission.display !== 'granted') {
    showToast('Vy chưa cấp quyền thông báo trên điện thoại.');
    return;
  }
  const notifications = [];
  const now = new Date();
  Object.keys(state.schedule).sort().forEach((key, index) => {
    const date = parseDate(key);
    const code = state.schedule[key];
    const label = reminderDescription(code);
    const morningAtSix = new Date(date);
    morningAtSix.setHours(6, 0, 0, 0);
    if (morningAtSix > now) {
      notifications.push({
        id: 600000 + index,
        title: '🌷 Chào buổi sáng, Vy yêu',
        body: nativeReminderBody('morning', label, date),
        schedule: { at: morningAtSix },
        extra: { url: '/?section=calendar' },
        smallIcon: 'ic_stat_icon_config_sample'
      });
    }
    const noonAtTwelve = new Date(date);
    noonAtTwelve.setHours(12, 0, 0, 0);
    if (noonAtTwelve > now) {
      notifications.push({
        id: 1200000 + index,
        title: '☀️ Chúc em yêu buổi trưa vui vẻ',
        body: nativeReminderBody('noon', label, date),
        schedule: { at: noonAtTwelve },
        extra: { url: '/?section=calendar' },
        smallIcon: 'ic_stat_icon_config_sample'
      });
    }
    const eveningAtEight = new Date(date);
    eveningAtEight.setDate(eveningAtEight.getDate() - 1);
    eveningAtEight.setHours(20, 0, 0, 0);
    if (eveningAtEight > now) {
      notifications.push({
        id: 2000000 + index,
        title: '🌙 Chúc em yêu buổi tối thật dịu dàng',
        body: nativeReminderBody('evening', label, date),
        schedule: { at: eveningAtEight },
        extra: { url: '/?section=calendar' },
        smallIcon: 'ic_stat_icon_config_sample'
      });
    }
  });
  if (notifications.length) await localNotifications.schedule({ notifications });
}

function updateNotificationUi(permission = ('Notification' in window ? Notification.permission : 'unsupported')) {
  const enabled = permission === 'granted';
  if (isIosDevice() && !isHomeScreenApp() && !enabled) {
    $('#reminderTitle').textContent = 'Cài app lên màn hình chính để bật nhắc';
    $('#reminderDescription').textContent = 'Safari thường không xin quyền thông báo cho app này. Hãy thêm vào màn hình chính trước.';
    $('#enableNotification').textContent = 'Cách bật';
    return;
  }
  $('#notificationIcon').textContent = enabled ? '♥' : '♡';
  $('#reminderTitle').textContent = enabled ? 'Nhắc lịch đã bật' : 'Nhắc lịch đang tắt';
  $('#reminderDescription').textContent = enabled ? '' : 'Bật thông báo để Vy không bỏ lỡ ca làm nhé.';
  $('#enableNotification').textContent = enabled ? 'Đã bật' : 'Bật nhắc';
}

function bindEvents() {
  $('#loginForm').addEventListener('submit', handleLogin);
  $('#showAdminLogin').addEventListener('click', () => {
    $('#loginForm').hidden = true;
    $('#showAdminLogin').hidden = true;
    $('#adminLoginPanel').hidden = false;
  });
  $('#backToVyLogin').addEventListener('click', () => {
    $('#loginForm').hidden = false;
    $('#showAdminLogin').hidden = false;
    $('#adminLoginPanel').hidden = true;
  });
  $('#adminLoginForm').addEventListener('submit', handleAdminLogin);
  $('#adminLogout').addEventListener('click', leaveAdminScreen);
  $('#enableAdminNotifications').addEventListener('click', enableAdminNotifications);
  $('#refreshFoodRequests').addEventListener('click', loadFoodRequests);
  $('#refreshAdminSchedule').addEventListener('click', loadAdminSchedule);
  $('#sendFoodRequest').addEventListener('click', submitFoodRequest);
  $$('.mood-picker [data-mood]').forEach((button) => button.addEventListener('click', () => {
    state.selectedMood = button.dataset.mood;
    $$('.mood-picker [data-mood]').forEach((item) => item.classList.toggle('active', item === button));
  }));
  $('#saveMood').addEventListener('click', saveMood);
  $('#refreshMood').addEventListener('click', () => loadMood('admin'));
  $('#chatForm').addEventListener('submit', (event) => {
    event.preventDefault();
    sendChatMessage('vy');
  });
  $('#adminChatForm').addEventListener('submit', (event) => {
    event.preventDefault();
    sendChatMessage('admin');
  });
  bindChatQuickReplies();
  bindChatImagePicker('vy');
  bindChatImagePicker('admin');
  $('#startVoiceCall').addEventListener('click', () => openCallLobby('vy', 'voice'));
  $('#startVideoCall').addEventListener('click', () => openCallLobby('vy', 'video'));
  $('#joinVideoCall').addEventListener('click', () => joinLiveKitCall('vy', false));
  $('#acceptCall').addEventListener('click', () => acceptIncomingCall('vy'));
  $('#declineCall').addEventListener('click', () => declineIncomingCall('vy'));
  $('#closeCall').addEventListener('click', () => (livekitRoom ? leaveLiveKitCall() : closeCallOverlay('vy')));
  $('#toggleCamera').addEventListener('click', () => toggleCallCamera('vy'));
  $('#toggleMicrophone').addEventListener('click', () => toggleCallMicrophone('vy'));
  $('#toggleCallFilters').addEventListener('click', () => toggleCallFilters('vy'));
  $('#endCall').addEventListener('click', leaveLiveKitCall);
  $$('[data-call-snapshot]').forEach((button) => button.addEventListener('click', () => captureCallSnapshot(button.dataset.callSnapshot)));
  $$('[data-call-reaction]').forEach((button) => button.addEventListener('click', () => {
    const role = button.closest('.call-overlay')?.id === 'adminCallSection' ? 'admin' : 'vy';
    sendCallReaction(role, button.dataset.callReaction);
  }));
  $('#startAdminVoiceCall').addEventListener('click', () => openCallLobby('admin', 'voice'));
  $('#startAdminVideoCall').addEventListener('click', () => openCallLobby('admin', 'video'));
  $('#joinAdminVideoCall').addEventListener('click', () => joinLiveKitCall('admin', false));
  $('#acceptAdminCall').addEventListener('click', () => acceptIncomingCall('admin'));
  $('#declineAdminCall').addEventListener('click', () => declineIncomingCall('admin'));
  $('#closeAdminCall').addEventListener('click', () => (livekitRoom ? leaveLiveKitCall() : closeCallOverlay('admin')));
  $('#toggleAdminCamera').addEventListener('click', () => toggleCallCamera('admin'));
  $('#toggleAdminMicrophone').addEventListener('click', () => toggleCallMicrophone('admin'));
  $('#toggleAdminCallFilters').addEventListener('click', () => toggleCallFilters('admin'));
  $('#endAdminCall').addEventListener('click', leaveLiveKitCall);
  $$('.call-filters [data-call-filter]').forEach((button) => button.addEventListener('click', () => {
    setCallFilter(button.closest('.call-overlay').id === 'adminCallSection' ? 'admin' : 'vy', button.dataset.callFilter);
  }));
  $('#logoutButton').addEventListener('click', handleLogout);
  $('#enableNotification').addEventListener('click', enableNotifications);
  $('#exportCalendar').addEventListener('click', exportCalendarFile);
  $('#notificationButton').addEventListener('click', enableNotifications);
  $('#previousMonth').addEventListener('click', () => {
    changeVisibleMonth(-1);
  });
  $('#nextMonth').addEventListener('click', () => {
    changeVisibleMonth(1);
  });
  $('#adminPreviousMonth').addEventListener('click', () => {
    state.adminVisibleMonth = new Date(state.adminVisibleMonth.getFullYear(), state.adminVisibleMonth.getMonth() - 1, 1);
    renderAdminCalendar();
  });
  $('#adminNextMonth').addEventListener('click', () => {
    state.adminVisibleMonth = new Date(state.adminVisibleMonth.getFullYear(), state.adminVisibleMonth.getMonth() + 1, 1);
    renderAdminCalendar();
  });
  bindCalendarSwipe();
  $('#closeModal').addEventListener('click', closeDayModal);
  $('#dayModal').addEventListener('click', (event) => {
    if (event.target === $('#dayModal')) closeDayModal();
  });
  $$('#shiftPicker button').forEach((button) => button.addEventListener('click', () => {
    state.selectedCode = button.dataset.code;
    $$('#shiftPicker button').forEach((item) => item.classList.toggle('active', item === button));
  }));
  $('#saveShift').addEventListener('click', () => {
    if (!state.selectedDate || !state.selectedCode) return;
    state.schedule[state.selectedDate] = state.selectedCode;
    saveSchedule();
    renderOverview();
    closeDayModal();
    showToast('Đã lưu lịch mới cho Vy rồi nha 🌷');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#dayModal').hidden) closeDayModal();
  });
}

function init() {
  applyAvatarImage();
  renderFoodMenu();
  bindEvents();
  bindNotificationNavigation();
  setAuthenticated(localStorage.getItem(AUTH_KEY) === 'true');
  renderOverview();
  renderCalendar();
  renderLoveCounter();
  loadMood('vy');
  updateNotificationUi();
  renderLiveCountdown();
  state.countdownTimer = setInterval(renderLiveCountdown, 30000);
  state.loveCounterTimer = setInterval(renderLoveCounter, 1000);
  $('#lastUpdated').textContent = `Cập nhật ${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date())}`;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
      console.error('Không đăng ký được service worker:', error);
    });
  }
  if (localStorage.getItem(ADMIN_TOKEN_KEY)) showAdminScreen();
  if (localStorage.getItem(AUTH_KEY) === 'true') loadSharedSchedule();
  handleIncomingCallHint();
  handleIncomingNotificationTarget();
}

init();
