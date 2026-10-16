import { AVATAR_IMAGE_URL } from './avatar-config.js';
import { KARAOKE_CATEGORIES, UNIQUE_KARAOKE_SONGS } from './karaoke-data.js';
import { activeTimedLyricIndex, estimateLyricLineIntervals, fitTimedLyricIntervalsToAudio, getLineState, karaokeLyricsTextSimilarity, lrcLineIntervals, normalizeTimedLyrics, parseSyncedKaraokeLyrics, timingMatchesAudio } from './karaoke-timing.js';

const ADMIN_TOKEN_KEY = 'lich-cua-vy-admin-token-v1';
const VY_TOKEN_KEY = 'lich-cua-vy-audio-session-v1';
const ADMIN_PUSH_ENABLED_KEY = 'lich-cua-vy-admin-push-enabled-v1';
const CHAT_IMAGE_PREFIX = '__lich_chat_image__:';
const CHAT_CALL_PREFIX = '__lich_call__:';
const CALL_MEDIA_PREFS_KEY = 'lich-cua-vy-call-media-prefs-v1';
const KARAOKE_STORAGE_KEY = 'lich-cua-vy-karaoke-selection-v1';
const KARAOKE_LYRICS_DIR = '/lyrics/';
const KARAOKE_LYRICS_STORAGE_KEY = 'lich-cua-vy-karaoke-lyrics-v2';
const KARAOKE_LYRICS_UI_STORAGE_KEY = 'lich-cua-vy-karaoke-lyrics-ui-v1';
const CHAT_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const LOVE_START_DATE = new Date(2022, 10, 3, 0, 0, 0);
const FACE_LANDMARKER_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const FACE_LANDMARKER_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm';

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
  authenticatedRole: null,
  schedule: {},
  visibleMonth: new Date(),
  selectedDate: null,
  selectedCode: null,
  selectedFoods: [],
  karaokeCategory: 'all',
  karaokeQuery: '',
  karaokeShowSelected: false,
  karaokeSelected: loadKaraokeSelection(),
  karaokeLyrics: loadKaraokeLyrics(),
  // Live lyrics are kept in memory only when the provider does not grant offline caching rights.
  karaokeLyricsSession: {},
  karaokePlaybackQueue: [],
  karaokeLyricsModal: createKaraokeLyricsModalState(),
  karaokeAudio: { songId: null, status: 'idle', message: '', requestId: 0, controller: null, entry: null, activeLineIndex: -1, autoPlay: false },
  toastTimer: null,
  countdownTimer: null,
  chatTimer: null,
  chatLoading: false,
  loveCounterTimer: null,
  selectedMood: 'loved',
  adminVisibleMonth: new Date(),
  adminSchedule: {}
};

function sessionToken(role = 'vy') {
  return localStorage.getItem(role === 'admin' ? ADMIN_TOKEN_KEY : VY_TOKEN_KEY) || '';
}

function sessionHeaders(role = 'vy', extra = {}) {
  const token = sessionToken(role);
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

let nativeNotificationsPromise;
let liveKitSDK;
let liveKitSDKPromise;
let livekitRoom;
let activeCallRole;
let activeCallType = 'video';
let pendingIncomingCall = null;
let faceLandmarkerPromise;
let activeFilterPipeline;
let incomingAlertTimer;
let incomingAudioContext;
let incomingAlertRole;
let karaokeJudgeSession;
let karaokeJudgeRequestId = 0;
let karaokeNextTrackTimer = 0;
let karaokeVocalGraph;
let karaokeVocalProcessing = false;
let karaokeLyricsProgrammaticScrollUntil = 0;
let karaokeLyricsFollowPaused = false;
let karaokeLyricsRafId = 0;
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
}

async function saveMood() {
  const status = $('#moodStatus');
  const note = $('#moodNote').value.trim();
  const moodMeta = { happy: ['😊', 'Vui'], loved: ['🥰', 'Được yêu'], tired: ['😴', 'Hơi mệt'], sad: ['🥺', 'Buồn'], excited: ['✨', 'Háo hức'] }[state.selectedMood] || ['💗', 'Được yêu'];
  localStorage.setItem('lich-cua-vy-mood-v1', JSON.stringify({ mood: state.selectedMood, note, emoji: moodMeta[0], label: moodMeta[1], savedAt: new Date().toISOString() }));
  status.textContent = 'Đã lưu mood riêng trên thiết bị này 💗';
}

async function syncScheduleToServer(schedule = state.schedule) {
  const response = await fetch('/api/schedule', {
    method: 'PUT',
    headers: sessionHeaders('vy', { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ schedule })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Chưa đồng bộ được lịch của Vy.');
  return data;
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

function loadKaraokeSelection() {
  try {
    const saved = JSON.parse(localStorage.getItem(KARAOKE_STORAGE_KEY) || '[]');
    if (!Array.isArray(saved)) return new Set();
    const knownTitles = new Set(UNIQUE_KARAOKE_SONGS.map((song) => song.title));
    return new Set(saved.filter((title) => knownTitles.has(title)));
  } catch {
    return new Set();
  }
}

function saveKaraokeSelection() {
  localStorage.setItem(KARAOKE_STORAGE_KEY, JSON.stringify([...state.karaokeSelected]));
}

function loadKaraokeLyrics() {
  try {
    const saved = JSON.parse(localStorage.getItem(KARAOKE_LYRICS_STORAGE_KEY) || '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    const knownIds = new Set(UNIQUE_KARAOKE_SONGS.map((song) => song.songId));
    return Object.fromEntries(Object.entries(saved).filter(([songId, value]) => (
      knownIds.has(songId) && value && typeof value.text === 'string' && value.text.trim()
    )));
  } catch {
    return {};
  }
}

function saveKaraokeLyrics() {
  localStorage.setItem(KARAOKE_LYRICS_STORAGE_KEY, JSON.stringify(state.karaokeLyrics));
}

function rememberKaraokeLyricsSession(song, data) {
  if (!song || !data?.lyrics?.trim()) return;
  state.karaokeLyricsSession[song.songId] = {
    text: data.lyrics,
    syncedLyrics: data.syncedLyrics || '',
    wordSyncLines: Array.isArray(data.wordSyncLines) ? data.wordSyncLines : [],
    source: data.source || 'lrclib',
    artist: data.artist || '',
    providerTrackId: data.providerTrackId || '',
    albumName: data.albumName || '',
    durationSeconds: data.durationSeconds || null,
    hasWordSync: data.hasWordSync === true,
    attribution: data.attribution || '',
    sourceUrl: data.sourceUrl || '',
    updatedAt: new Date().toISOString()
  };
}

function karaokeLyricsForSong(song) {
  const saved = state.karaokeLyrics[song.songId];
  const live = state.karaokeLyricsSession[song.songId];
  if (saved && live && karaokeSessionHasTimestamps(live) && !karaokeSessionHasTimestamps(saved)) {
    return { ...saved, ...live, text: saved.text || live.text };
  }
  return saved || live || null;
}

function loadKaraokeLyricsUi() {
  try {
    const saved = JSON.parse(localStorage.getItem(KARAOKE_LYRICS_UI_STORAGE_KEY) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function saveKaraokeLyricsUi() {
  const session = state.karaokeLyricsModal;
  const saved = loadKaraokeLyricsUi();
  if (session.songId) {
    saved[session.songId] = {
      hiddenLines: [...session.hiddenLines],
      importantLines: [...session.importantLines],
      studyMode: session.studyMode
    };
  }
  localStorage.setItem(KARAOKE_LYRICS_UI_STORAGE_KEY, JSON.stringify(saved));
}

function loadKaraokeLyricsPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(`${KARAOKE_LYRICS_UI_STORAGE_KEY}:prefs`) || '{}');
    return {
      fontSize: Math.min(34, Math.max(14, Number(saved.fontSize) || 20)),
      align: saved.align === 'center' ? 'center' : 'left'
    };
  } catch {
    return { fontSize: 20, align: 'center' };
  }
}

function saveKaraokeLyricsPrefs() {
  const { fontSize, align } = state.karaokeLyricsModal;
  localStorage.setItem(`${KARAOKE_LYRICS_UI_STORAGE_KEY}:prefs`, JSON.stringify({ fontSize, align }));
}

function createKaraokeLyricsModalState() {
  const prefs = loadKaraokeLyricsPrefs();
  return {
    songId: null,
    text: '',
    syncedLyrics: '',
    wordSyncLines: [],
    source: '',
    durationSeconds: null,
    metadata: null,
    providerTrackId: '',
    loading: false,
    error: false,
    editing: false,
    studyMode: false,
    hiddenLines: new Set(),
    importantLines: new Set(),
    fontSize: prefs.fontSize,
    align: prefs.align,
    fullscreen: false,
    karaokeActive: false,
    sourceUrl: '',
    sourceName: '',
    requestId: ''
  };
}

function lyricsUiForSong(songId) {
  const saved = loadKaraokeLyricsUi()[songId] || {};
  return {
    hiddenLines: new Set(Array.isArray(saved.hiddenLines) ? saved.hiddenLines.map(Number).filter(Number.isInteger) : []),
    importantLines: new Set(Array.isArray(saved.importantLines) ? saved.importantLines.map(Number).filter(Number.isInteger) : []),
    studyMode: saved.studyMode === true
  };
}

function currentKaraokeLyricsSong() {
  return UNIQUE_KARAOKE_SONGS.find((song) => song.songId === state.karaokeLyricsModal.songId);
}

function formatKaraokeTime(value) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const seconds = Math.floor(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function renderKaraokeAudioControls() {
  const session = state.karaokeAudio;
  const audio = $('#karaokeAudioElement');
  const play = $('#karaokeAudioPlay');
  const seek = $('#karaokeAudioSeek');
  const status = $('#karaokeAudioStatus');
  if (!audio || !play || !seek || !status) return;
  status.textContent = session.message || 'Chưa mở audio';
  status.dataset.state = session.status;
  play.disabled = session.status !== 'ready' && session.status !== 'buffering';
  play.textContent = audio.paused ? '▶' : 'Ⅱ';
  play.setAttribute('aria-label', audio.paused ? 'Phát nhạc' : 'Tạm dừng nhạc');
  seek.disabled = !Number.isFinite(audio.duration) || audio.duration <= 0;
  if (Number.isFinite(audio.duration)) {
    seek.max = String(audio.duration);
    $('#karaokeAudioDuration').textContent = formatKaraokeTime(audio.duration);
  } else {
    seek.max = '0';
    $('#karaokeAudioDuration').textContent = '0:00';
  }
  if (!audio.seeking) seek.value = String(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
  $('#karaokeAudioCurrentTime').textContent = formatKaraokeTime(audio.currentTime);
}

function setKaraokeAudioVolume(value) {
  const audio = $('#karaokeAudioElement');
  if (!audio) return;
  const volume = Math.max(0, Math.min(1, Number(value)));
  if (!Number.isFinite(volume)) return;

  const graph = karaokeVocalGraph;
  if (graph?.masterGain) {
    // MediaElementAudioSourceNode output bypasses the normal element volume
    // control in some browsers, so control every Web Audio path at the master.
    audio.volume = 1;
    const now = graph.context.currentTime;
    graph.masterGain.gain.cancelScheduledValues(now);
    graph.masterGain.gain.setTargetAtTime(volume, now, 0.015);
  } else {
    audio.volume = volume;
  }
}

function setKaraokeVocalMix(enabled) {
  const graph = karaokeVocalGraph;
  if (!graph) return;
  const now = graph.context.currentTime;
  const gains = enabled ? [0.72, -0.68, -0.68, 0.72] : [1, 0, 0, 1];
  graph.gains.forEach((gain, index) => {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(gains[index], now, 0.025);
  });
  graph.bassGains.forEach((gain) => {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(enabled ? 0.58 : 0, now, 0.025);
  });
  graph.safetyGains.forEach((gain) => {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(enabled ? 0.12 : 0, now, 0.025);
  });
  graph.dryGain.gain.setTargetAtTime(enabled ? 0.12 : 1, now, 0.025);
  graph.outputGain.gain.setTargetAtTime(enabled ? 1.1 : 0, now, 0.025);
}

async function enableKaraokeVocalReduction(enabled) {
  const audio = $('#karaokeAudioElement');
  const status = $('#karaokeVocalStatus');
  if (!audio || !status || karaokeVocalProcessing) return;
  if (!enabled) {
    setKaraokeVocalMix(false);
    status.textContent = 'Đang phát bản gốc.';
    return;
  }
  if (karaokeVocalGraph) {
    setKaraokeVocalMix(true);
    try {
      if (karaokeVocalGraph.context.state === 'suspended') await karaokeVocalGraph.context.resume();
      if (state.karaokeAudio.autoPlay) {
        await audio.play();
        state.karaokeAudio.autoPlay = false;
      }
    } catch {
      status.textContent = 'Giảm giọng đã sẵn sàng · chạm nút phát để bắt đầu.';
      return;
    }
    status.textContent = 'Đã bật giảm giọng ca sĩ.';
    return;
  }
  const sourceUrl = audio.currentSrc;
  if (!sourceUrl) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    status.textContent = 'Thiết bị chưa hỗ trợ giảm giọng · vẫn phát nhạc gốc.';
    return;
  }
  karaokeVocalProcessing = true;
  status.textContent = 'Đang bật chế độ giảm giọng…';
  let sourceReloaded = false;
  try {
    const probeController = new AbortController();
    const probeTimeout = setTimeout(() => probeController.abort(), 5000);
    let probe;
    try {
      probe = await fetch(sourceUrl, { headers: { Range: 'bytes=0-0' }, signal: probeController.signal });
      if (!probe.ok) throw new Error('Audio không cho phép xử lý trên trình duyệt.');
      await probe.body?.cancel();
    } finally {
      clearTimeout(probeTimeout);
    }
    if (!probe) throw new Error('Không kiểm tra được nguồn audio.');

    const wasPlaying = !audio.paused;
    const currentTime = audio.currentTime;
    audio.pause();
    audio.crossOrigin = 'anonymous';
    audio.src = sourceUrl;
    audio.load();
    sourceReloaded = true;
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        audio.removeEventListener('canplay', ready);
        audio.removeEventListener('error', failed);
        clearTimeout(timeout);
      };
      const ready = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error('Không tải lại được audio để giảm giọng.')); };
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Nguồn audio phản hồi quá lâu.')); }, 10000);
      audio.addEventListener('canplay', ready, { once: true });
      audio.addEventListener('error', failed, { once: true });
    });

    const context = new AudioContextClass();
    const media = context.createMediaElementSource(audio);
    const splitter = context.createChannelSplitter(2);
    const merger = context.createChannelMerger(2);
    const gains = [0.72, -0.68, -0.68, 0.72].map((value) => {
      const node = context.createGain();
      node.gain.value = value;
      return node;
    });
    const bassFilters = [0, 1].map(() => {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 160;
      filter.Q.value = 0.707;
      return filter;
    });
    const bassGains = bassFilters.map(() => {
      const node = context.createGain();
      node.gain.value = 0.58;
      return node;
    });
    const safetyGains = [0, 1].map(() => {
      const node = context.createGain();
      node.gain.value = 0.12;
      return node;
    });
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.18;
    const outputGain = context.createGain();
    outputGain.gain.value = 1.1;
    const dryGain = context.createGain();
    dryGain.gain.value = 0.12;
    const masterGain = context.createGain();
    masterGain.gain.value = 1;
    media.connect(splitter);
    media.connect(dryGain);
    dryGain.connect(masterGain);
    splitter.connect(gains[0], 0); gains[0].connect(merger, 0, 0);
    splitter.connect(gains[1], 1); gains[1].connect(merger, 0, 0);
    splitter.connect(gains[2], 0); gains[2].connect(merger, 0, 1);
    splitter.connect(gains[3], 1); gains[3].connect(merger, 0, 1);
    splitter.connect(bassFilters[0], 0); bassFilters[0].connect(bassGains[0]); bassGains[0].connect(merger, 0, 0); bassGains[0].connect(merger, 0, 1);
    splitter.connect(bassFilters[1], 1); bassFilters[1].connect(bassGains[1]); bassGains[1].connect(merger, 0, 0); bassGains[1].connect(merger, 0, 1);
    splitter.connect(safetyGains[0], 0); safetyGains[0].connect(merger, 0, 0);
    splitter.connect(safetyGains[1], 1); safetyGains[1].connect(merger, 0, 1);
    merger.connect(limiter);
    limiter.connect(outputGain);
    outputGain.connect(masterGain);
    masterGain.connect(context.destination);
    karaokeVocalGraph = { context, gains, bassGains, safetyGains, dryGain, outputGain, masterGain };
    setKaraokeAudioVolume($('#karaokeAudioVolume')?.value ?? 0.8);
    audio.currentTime = Math.min(currentTime, Number.isFinite(audio.duration) ? audio.duration : currentTime);
    if (wasPlaying || state.karaokeAudio.autoPlay) {
      await context.resume();
      await audio.play();
      state.karaokeAudio.autoPlay = false;
    }
    status.textContent = 'Đã triệt giọng mạnh, giữ beat · hiệu quả tùy bản phối.';
  } catch (error) {
    if (karaokeVocalGraph) {
      status.textContent = 'Giảm giọng đã sẵn sàng · chạm phát để bắt đầu.';
    } else {
      status.textContent = 'Thiết bị chưa xử lý được giọng ca sĩ; chưa phát bản gốc trong chế độ karaoke.';
      status.textContent = 'Giảm giọng không khả dụng trên thiết bị này · đang phát nhạc để bạn vẫn hát theo.';
      if (state.karaokeAudio.autoPlay) {
        audio.play().then(() => { state.karaokeAudio.autoPlay = false; }).catch(() => {
          status.textContent = 'Không phát được beat. Chạm nút phát để thử lại.';
        });
      }
    }
    if (sourceReloaded && !audio.currentSrc) {
      audio.removeAttribute('crossorigin');
      audio.src = sourceUrl;
      audio.load();
    }
  } finally {
    karaokeVocalProcessing = false;
    renderKaraokeAudioControls();
  }
}

function karaokeJudgeStats(session) {
  const activeRatio = session.samples ? session.activeSamples / session.samples : 0;
  const activeVolume = session.activeSamples ? session.activeRms / session.activeSamples : 0;
  const participation = Math.max(0, Math.min(100, Math.round((activeRatio - 0.06) * 165)));
  const volume = Math.max(0, Math.min(100, Math.round((activeVolume - 0.008) * 1350)));
  const steps = [];
  for (let index = 1; index < session.pitches.length; index += 1) {
    const semitones = Math.abs(12 * Math.log2(session.pitches[index] / session.pitches[index - 1]));
    if (Number.isFinite(semitones) && semitones < 12) steps.push(semitones);
  }
  const averageStep = steps.length ? steps.reduce((sum, value) => sum + value, 0) / steps.length : null;
  const pitch = averageStep === null ? 0 : Math.max(0, Math.min(100, Math.round(100 - averageStep * 13)));
  return { participation, volume, pitch, total: Math.round(participation * 0.4 + volume * 0.25 + pitch * 0.35) };
}

function showKaraokeScorePopup(stats) {
  $('#karaokeFinalScore').textContent = String(stats.total);
  $('#karaokeScoreComment').textContent = karaokeJudgeCommentary(stats.total);
  $('#karaokeScorePopup').hidden = false;
  $('#doneKaraokeScorePopup').focus();
}

function closeKaraokeScorePopup() {
  $('#karaokeScorePopup').hidden = true;
  $('#karaokeJudgeButton')?.focus();
}

function karaokeJudgeCommentary(score) {
  if (score >= 95) return 'Giám khảo xin số để đặt show riêng.';
  if (score >= 85) return 'Hay đến mức bàn bên quên gọi món.';
  if (score >= 70) return 'Có tố chất! Mic đề nghị hát thêm một bài.';
  if (score >= 50) return 'Nhiệt tình cứu cả quán, bản phối hơi hồi hộp.';
  return 'Mic ghi nhận sự tự tin. Khán giả xin encore sau khi tập.';
}

function karaokePitchFromBuffer(buffer, sampleRate) {
  const minLag = Math.max(2, Math.floor(sampleRate / 500));
  const maxLag = Math.min(buffer.length - 2, Math.floor(sampleRate / 75));
  let energy = 0;
  for (let index = 0; index < buffer.length; index += 2) energy += buffer[index] * buffer[index];
  if (energy / (buffer.length / 2) < 0.00008) return null;
  let bestLag = 0;
  let bestCorrelation = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    let count = 0;
    for (let index = 0; index < buffer.length - lag; index += 2) {
      correlation += buffer[index] * buffer[index + lag];
      count += 1;
    }
    correlation /= count || 1;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }
  return bestLag ? sampleRate / bestLag : null;
}

async function finishKaraokeJudge({ failed = false } = {}) {
  const session = karaokeJudgeSession;
  if (!session) return;
  karaokeJudgeSession = null;
  cancelAnimationFrame(session.frameId);
  session.stream.getTracks().forEach((track) => track.stop());
  await session.context.close().catch(() => {});
  const button = $('#karaokeJudgeButton');
  const timer = $('#karaokeJudgeTimer');
  const caption = $('#karaokeJudgeCaption');
  caption.hidden = false;
  button.classList.remove('is-recording');
  button.textContent = '🎙️ Chấm lại';
  timer.textContent = '';
  if (failed) {
    caption.textContent = 'Không lấy được dữ liệu giọng hát. Kiểm tra quyền mic rồi thử lại nhé.';
    return;
  }
  if (session.samples < 10) {
    caption.textContent = 'Màn trình diễn hơi ngắn! Hát thêm vài giây để ban giám khảo chấm nha.';
    return;
  }
  const stats = karaokeJudgeStats(session);
  caption.textContent = 'Bài hát hoàn tất.';
  showKaraokeScorePopup(stats);
}

async function startKaraokeJudge() {
  const button = $('#karaokeJudgeButton');
  const caption = $('#karaokeJudgeCaption');
  const timer = $('#karaokeJudgeTimer');
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!navigator.mediaDevices?.getUserMedia || !AudioContextClass) {
    caption.hidden = false;
    caption.textContent = 'Trình duyệt này chưa hỗ trợ chấm bằng mic. Thử mở app trên Safari hoặc Chrome nhé.';
    return;
  }
  const requestId = ++karaokeJudgeRequestId;
  button.disabled = true;
  caption.hidden = false;
  caption.textContent = 'Chuẩn bị sân khấu… xin đừng hát vào mic khi chưa bật nhé!';
  let stream;
  let context;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (requestId !== karaokeJudgeRequestId || $('#karaokeLyricsModal').hidden) {
      stream.getTracks().forEach((track) => track.stop());
      button.disabled = false;
      return;
    }
    context = new AudioContextClass();
    await context.resume();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.2;
    context.createMediaStreamSource(stream).connect(analyser);
    const session = karaokeJudgeSession = {
      songId: state.karaokeLyricsModal.songId, stream, context, analyser, buffer: new Float32Array(analyser.fftSize),
      samples: 0, activeSamples: 0, activeRms: 0, pitches: [], frameId: 0,
      startedAt: performance.now(), lastSampleAt: 0
    };
    $('#karaokeScorePopup').hidden = true;
    caption.textContent = 'Đang hát…';
    button.disabled = false;
    button.classList.add('is-recording');
    button.textContent = '■ Kết thúc & xem điểm';
    const sample = (now) => {
      if (karaokeJudgeSession !== session) return;
      if (now - session.lastSampleAt >= 120) {
        session.lastSampleAt = now;
        analyser.getFloatTimeDomainData(session.buffer);
        let sum = 0;
        for (let index = 0; index < session.buffer.length; index += 1) sum += session.buffer[index] * session.buffer[index];
        const rms = Math.sqrt(sum / session.buffer.length);
        session.samples += 1;
        if (rms >= 0.009) {
          session.activeSamples += 1;
          session.activeRms += rms;
          const pitch = karaokePitchFromBuffer(session.buffer, context.sampleRate);
          if (pitch) session.pitches.push(pitch);
        }
        const elapsed = Math.floor((now - session.startedAt) / 1000);
        timer.textContent = formatKaraokeTime(elapsed);
        if (elapsed >= 480) {
          finishKaraokeJudge();
          return;
        }
      }
      session.frameId = requestAnimationFrame(sample);
    };
    session.frameId = requestAnimationFrame(sample);
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    await context?.close().catch(() => {});
    button.disabled = false;
    button.classList.remove('is-recording');
    button.textContent = '🎙️ Thử bật mic lại';
    caption.textContent = error.name === 'NotAllowedError'
      ? 'Mic đang bị từ chối quyền. Cho phép dùng mic trong cài đặt trình duyệt rồi thử lại nha.'
      : 'Chưa bật được sân khấu. Hãy kiểm tra mic rồi thử lại nhé.';
  }
}

async function beginKaraokeSession() {
  const session = state.karaokeLyricsModal;
  const audioState = state.karaokeAudio;
  if (!session.songId || audioState.songId !== session.songId) return;
  session.karaokeActive = true;
  $('#karaokeAudioPanel').hidden = false;
  $('#karaokeLyricsBody').hidden = false;
  $('#karaokeJudgeButton').textContent = '🎙️ Bắt đầu hát';
  $('#karaokeJudgeCaption').textContent = 'Beat đã bật, lời sẽ chạy theo nhạc.';
  $('#karaokeJudgeCaption').hidden = false;
  renderKaraokeLyricsModal();
  const audio = $('#karaokeAudioElement');
  if (audio && Number.isFinite(audio.duration)) audio.currentTime = 0;
  if (audioState.status === 'ready' || audioState.status === 'buffering') {
    audioState.autoPlay = true;
    await enableKaraokeVocalReduction(true);
  } else {
    audioState.autoPlay = true;
    $('#karaokeVocalStatus').textContent = 'Đang chuẩn bị beat và giảm giọng ca sĩ…';
  }
  await startKaraokeJudge();
}

function resetKaraokeAudio(message = '', status = 'idle') {
  stopKaraokeLyricsFrameLoop();
  const previous = state.karaokeAudio;
  previous.requestId += 1;
  previous.controller?.abort();
  const audio = $('#karaokeAudioElement');
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  state.karaokeAudio = {
    songId: null,
    status,
    message,
    requestId: previous.requestId,
    controller: null,
    entry: null,
    activeLineIndex: -1,
    autoPlay: false
  };
  renderKaraokeAudioControls();
  $('#karaokeLyricsText')?.querySelectorAll('.lyrics-line-row.is-current').forEach((line) => {
    line.classList.remove('is-current');
  });
}

async function requestKaraokeAudioUrl(songId, signal) {
  const adminView = $('#adminScreen')?.hidden === false;
  const userView = !adminView;
  const token = sessionToken(userView ? 'vy' : 'admin');
  if (!token) throw new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để nghe nhạc riêng tư.');

  const sendRequest = () => fetch(`/api/audio/url/${encodeURIComponent(songId)}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal
  });
  return sendRequest();
}

async function prepareKaraokeAudio(songId, autoPlay = false) {
  resetKaraokeAudio('Đang kiểm tra audio riêng tư…', 'loading');
  const audioState = state.karaokeAudio;
  audioState.autoPlay = autoPlay;
  audioState.songId = songId;
  const requestId = audioState.requestId;
  const controller = new AbortController();
  audioState.controller = controller;
  renderKaraokeAudioControls();
  try {
    const manifestResponse = await fetch('/audio-manifest.json', { cache: 'no-store', signal: controller.signal });
    const contentType = manifestResponse.headers.get('content-type') || '';
    if (!manifestResponse.ok || !/application\/json/i.test(contentType)) throw new Error('Không đọc được manifest audio.');
    const manifest = await manifestResponse.json();
    if (state.karaokeAudio.requestId !== requestId) return;
    const entry = manifest?.schemaVersion === 1 ? manifest.entries?.[songId] : null;
    if (!entry) {
      audioState.status = 'missing';
      audioState.message = 'Chưa tìm thấy audio được ghép cho bài này.';
      renderKaraokeAudioControls();
      return;
    }
    if (entry.songId && entry.songId !== songId) throw new Error('Manifest ghép nhầm songId; đã chặn phát audio.');
    if (typeof entry.objectKey !== 'string' || !entry.objectKey.startsWith(`audio/${songId}.`) || entry.objectKey.includes('..')) {
      throw new Error('Đường dẫn audio không khớp songId; đã chặn phát nhầm bài.');
    }
    if (typeof entry.mimeType !== 'string' || !entry.mimeType.startsWith('audio/')) throw new Error('Manifest thiếu MIME type audio hợp lệ.');
    audioState.entry = entry;
    const urlResponse = await requestKaraokeAudioUrl(songId, controller.signal);
    const payload = await urlResponse.json().catch(() => ({}));
    if (state.karaokeAudio.requestId !== requestId) return;
    if (!urlResponse.ok) {
      const error = new Error(payload.error || 'Máy chủ chưa cấp được đường dẫn audio riêng tư.');
      error.code = payload.code || (urlResponse.status === 404 ? 'AUDIO_NOT_FOUND' : 'AUDIO_PRIVATE_UNAVAILABLE');
      throw error;
    }
    if (payload.songId !== songId || payload.mimeType !== entry.mimeType || typeof payload.audioUrl !== 'string') {
      throw new Error('Thông tin audio từ máy chủ không khớp manifest của bài hát.');
    }
    const resolvedUrl = new URL(payload.audioUrl, window.location.origin);
    if (resolvedUrl.protocol !== 'https:' && resolvedUrl.origin !== window.location.origin) throw new Error('Đường dẫn audio không an toàn; đã chặn phát.');
    const audio = $('#karaokeAudioElement');
    if (!audio || state.karaokeAudio.requestId !== requestId) return;
    audio.src = resolvedUrl.href;
    audio.load();
    audioState.status = 'loading';
    audioState.message = 'Đang tải audio…';
  } catch (error) {
    if (error.name === 'AbortError' || state.karaokeAudio.requestId !== requestId) return;
    audioState.status = error.code === 'AUDIO_NOT_FOUND' ? 'missing' : 'error';
    audioState.message = error.message || 'Không tải được audio.';
  }
  renderKaraokeAudioControls();
}

function updateKaraokeSyncedLyrics({ refreshRows = false } = {}) {
  const audio = $('#karaokeAudioElement');
  const audioState = state.karaokeAudio;
  const session = state.karaokeLyricsModal;
  const view = $('#karaokeLyricsText');
  if (!audio || !view) return;
  const timeline = karaokeLyricsLineTimeline(session, audio, audioState);
  if (audioState.songId !== session.songId || !timeline.lines.length) {
    view.querySelectorAll('.lyrics-line-row.is-current, .lyrics-line-row.is-done')
      .forEach((line) => line.classList.remove('is-current', 'is-done'));
    return;
  }
  const lines = timeline.lines;
  if (!lines.length) {
    audioState.activeLineIndex = -1;
    view.querySelectorAll('.lyrics-line-row.is-current, .lyrics-line-row.is-done')
      .forEach((line) => line.classList.remove('is-current', 'is-done'));
    return;
  }
  const activeIndex = activeTimedLyricIndex(lines, audio.currentTime);
  const changedLine = activeIndex !== audioState.activeLineIndex;
  const refreshLineStyles = changedLine || refreshRows;
  audioState.activeLineIndex = activeIndex;
  const rows = view.querySelectorAll('[data-synced-lyric-index]');
  if (refreshLineStyles) {
    rows.forEach((row) => {
      const lineIndex = Number(row.dataset.syncedLyricIndex);
      const model = lines[lineIndex];
      const lineState = model ? getLineState(audio.currentTime, model) : 'upcoming';
      const isCurrent = lineIndex === activeIndex;
      row.classList.toggle('is-current', isCurrent);
      row.classList.toggle('is-done', lineState === 'done');
      if (changedLine && isCurrent && !karaokeLyricsFollowPaused) {
        $('#karaokeLyricsFollow')?.setAttribute('hidden', '');
        karaokeLyricsProgrammaticScrollUntil = Date.now() + 1200;
        const container = $('#karaokeLyricsBody');
        if (container) {
          const containerRect = container.getBoundingClientRect();
          const rowRect = row.getBoundingClientRect();
          const nextTop = container.scrollTop + rowRect.top - containerRect.top - container.clientHeight * 0.4;
          container.scrollTo({ top: nextTop, behavior: audio.seeking || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        }
      }
    });
  }
  const activeRow = activeIndex >= 0 ? view.querySelector(`[data-synced-lyric-index="${activeIndex}"]`) : null;
}

function karaokeLyricsTimingMatchesAudio(session, audio, audioState = state.karaokeAudio) {
  return timingMatchesAudio({
    songId: session?.songId,
    source: session?.source,
    providerTrackId: session?.providerTrackId,
    durationSeconds: session?.durationSeconds,
    audioSongId: audioState.songId,
    audioSrc: audio?.currentSrc,
    audioDuration: audio?.duration
  });
}

function karaokeLyricsLineTimeline(session, audio, audioState = state.karaokeAudio) {
  const wordLines = Array.isArray(session?.wordSyncLines) ? session.wordSyncLines : [];
  if (karaokeLyricsTimingMatchesAudio(session, audio, audioState)) {
    const lines = wordLines.length
      ? normalizeTimedLyrics(wordLines.map((line, index) => ({
        id: `${session.providerTrackId || session.songId}-word-line-${index}`,
        text: line?.text || (Array.isArray(line?.words) ? line.words.map((word) => word?.text || '').join('') : ''),
        startMs: line?.startMs,
        endMs: line?.endMs
      })), { warn: import.meta.env.DEV })
      : fitTimedLyricIntervalsToAudio(
        lrcLineIntervals(parseSyncedKaraokeLyrics(session.syncedLyrics), session.durationSeconds),
        session.durationSeconds,
        audio.duration
      );
    if (lines.length) return { lines, estimated: false, verified: true };
  }

  // Never advance the highlighted line from guessed timings. A wrong recording
  // can have the same lyrics but a different intro, arrangement, or tempo.
  return { lines: [], estimated: false, verified: false };
}

function startKaraokeLyricsFrameLoop() {
  const audio = $('#karaokeAudioElement');
  if (!audio || audio.paused || audio.ended || karaokeLyricsRafId
    || !karaokeLyricsLineTimeline(state.karaokeLyricsModal, audio).lines.length) return;
  const tick = () => {
    karaokeLyricsRafId = 0;
    if (audio.paused || audio.ended || state.karaokeAudio.songId !== state.karaokeLyricsModal.songId) return;
    updateKaraokeSyncedLyrics();
    karaokeLyricsRafId = requestAnimationFrame(tick);
  };
  karaokeLyricsRafId = requestAnimationFrame(tick);
}

function stopKaraokeLyricsFrameLoop() {
  if (!karaokeLyricsRafId) return;
  cancelAnimationFrame(karaokeLyricsRafId);
  karaokeLyricsRafId = 0;
}

function cacheKaraokeLyrics(song, data) {
  if (!song || !data?.lyrics || !data.cacheable) return false;
  state.karaokeLyrics[song.songId] = {
    text: data.lyrics,
    syncedLyrics: data.syncedLyrics || '',
    wordSyncLines: Array.isArray(data.wordSyncLines) ? data.wordSyncLines : [],
    source: data.source || 'licensed-api',
    artist: data.artist || '',
    providerTrackId: data.providerTrackId || '',
    albumName: data.albumName || '',
    durationSeconds: data.durationSeconds || null,
    hasWordSync: data.hasWordSync === true,
    attribution: data.attribution || '',
    updatedAt: new Date().toISOString()
  };
  saveKaraokeLyrics();
  return true;
}

async function fetchLiveKaraokeLyrics(song, { store = true } = {}) {
  try {
    const response = await fetch(`/api/lyrics/resolve/${encodeURIComponent(song.songId)}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.lyrics?.trim()) return null;
    if (store) {
      if (data.cacheable) cacheKaraokeLyrics(song, data);
      else rememberKaraokeLyricsSession(song, data);
    }
    return data;
  } catch {
    return null;
  }
}

function karaokeSessionHasTimestamps(session) {
  return Boolean(session?.wordSyncLines?.length || parseSyncedKaraokeLyrics(session?.syncedLyrics).length);
}

function sameKaraokeLyricsText(left, right) {
  return karaokeLyricsTextSimilarity(left, right) >= 0.9;
}

async function refreshKaraokeTimedLyrics(song, requestId) {
  const session = state.karaokeLyricsModal;
  if (session.requestId !== requestId || session.editing || session.sourceName === 'LRC có timestamp' || karaokeSessionHasTimestamps(session)) return;
  const liveLyrics = await fetchLiveKaraokeLyrics(song, { store: false });
  if (session.requestId !== requestId || session.editing || !liveLyrics || !(
    liveLyrics.wordSyncLines?.length || parseSyncedKaraokeLyrics(liveLyrics.syncedLyrics).length
  )) return;
  if (session.text.trim() && !sameKaraokeLyricsText(session.text, liveLyrics.lyrics)) return;
  const matchedLyrics = { ...liveLyrics, lyrics: session.text || liveLyrics.lyrics };
  if (matchedLyrics.cacheable) cacheKaraokeLyrics(song, matchedLyrics);
  else rememberKaraokeLyricsSession(song, matchedLyrics);
  session.syncedLyrics = liveLyrics.syncedLyrics || '';
  session.wordSyncLines = liveLyrics.wordSyncLines || [];
  session.source = liveLyrics.source || 'lrclib';
  session.durationSeconds = liveLyrics.durationSeconds || null;
  if (!session.text.trim()) session.text = liveLyrics.lyrics || '';
  session.providerTrackId = liveLyrics.providerTrackId || session.providerTrackId;
  session.sourceName = liveLyrics.sourceName || liveLyrics.source || 'LRCLIB';
  session.sourceUrl = liveLyrics.sourceUrl || '';
  session.loading = false;
  session.error = false;
  state.karaokeAudio.activeLineIndex = -1;
  renderKaraokeLyricsModal();
  updateKaraokeSyncedLyrics();
}

function waitBetweenKaraokeLibraryLookups() {
  return new Promise((resolve) => window.setTimeout(resolve, 550));
}

async function preloadKaraokeLyricsLibrary() {
  const button = $('#preloadKaraokeLyrics');
  const status = $('#karaokeLibraryLyricsStatus');
  if (!button || !status) return;
  const songs = UNIQUE_KARAOKE_SONGS.filter((song) => !karaokeSessionHasTimestamps(karaokeLyricsForSong(song)));
  if (!songs.length) {
    status.textContent = 'Các bài hiện có lời đồng bộ đã sẵn sàng trong phiên này.';
    return;
  }
  button.disabled = true;
  const counts = { synced: 0, mismatch: 0, verify: 0, missing: 0, failed: 0 };
  for (let index = 0; index < songs.length; index += 1) {
    const song = songs[index];
    status.textContent = `Đang tìm thêm lời ${index + 1}/${songs.length}: ${song.title}`;
    try {
      const response = await fetch(`/api/lyrics/resolve/${encodeURIComponent(song.songId)}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (data?.lyrics?.trim() && (data.wordSyncLines?.length || parseSyncedKaraokeLyrics(data.syncedLyrics).length)) {
        const existing = karaokeLyricsForSong(song);
        if (existing?.text?.trim() && !sameKaraokeLyricsText(existing.text, data.lyrics)) {
          counts.mismatch += 1;
        } else {
          const matchedLyrics = { ...data, lyrics: existing?.text || data.lyrics };
          if (data.cacheable) cacheKaraokeLyrics(song, matchedLyrics);
          else rememberKaraokeLyricsSession(song, matchedLyrics);
          counts.synced += 1;
        }
      } else if (data?.lyrics?.trim()) {
        counts.missing += 1;
      } else if (data?.status === 'needs_verification') {
        counts.verify += 1;
      } else if (response.ok) {
        counts.missing += 1;
      } else {
        counts.failed += 1;
      }
    } catch {
      counts.failed += 1;
    }
    if (index < songs.length - 1) await waitBetweenKaraokeLibraryLookups();
  }
  button.disabled = false;
  status.textContent = `Đã đồng bộ ${counts.synced} bài · lời không khớp ${counts.mismatch} · cần xác minh ${counts.verify} · chưa có timestamp ${counts.missing} · lỗi ${counts.failed}.`;
}

async function fetchStoredKaraokeLyrics(song) {
  try {
    const response = await fetch(`/api/lyrics/${encodeURIComponent(song.songId)}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.lyrics?.trim()) return null;
    cacheKaraokeLyrics(song, data);
    return data;
  } catch {
    return null;
  }
}

async function fetchKaraokeLyricsSource(song) {
  try {
    const response = await fetch(`/api/lyrics/source/${encodeURIComponent(song.songId)}`, { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function syncKaraokeSongFromProvider(song, token, force = false) {
  const response = await fetch('/api/lyrics/sync-one', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ songId: song.songId, force })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  cacheKaraokeLyrics(song, data);
  return data;
}

function waitBeforeLyricsRetry(attempt) {
  return new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
}

async function syncKaraokeLibrary() {
  const button = $('#syncKaraokeLyrics');
  const progress = $('#karaokeSyncProgress');
  const progressText = $('#karaokeSyncProgressText');
  const resultBox = $('#karaokeSyncResult');
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (!button || !progress || !progressText || !resultBox) return;
  if (!token) {
    progressText.textContent = 'Phiên quản trị đã hết hạn, hãy đăng nhập lại.';
    return;
  }
  const songs = UNIQUE_KARAOKE_SONGS.filter((song) => !state.karaokeLyrics[song.songId]);
  if (!songs.length) {
    progressText.textContent = 'Toàn bộ bài hiện có đã có lời lưu trên thiết bị này.';
    resultBox.hidden = false;
    resultBox.textContent = 'Không có bài mới cần đồng bộ.';
    return;
  }
  button.disabled = true;
  progress.hidden = false;
  progress.max = songs.length;
  progress.value = 0;
  resultBox.hidden = true;
  const counts = { saved: 0, skipped: 0, displayOnly: 0, linkOnly: 0, verify: 0, failed: 0 };
  const failures = [];
  for (let index = 0; index < songs.length; index += 1) {
    const song = songs[index];
    progressText.textContent = `Đang tìm ${index + 1}/${songs.length}: ${song.title}`;
    let data;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        data = await syncKaraokeSongFromProvider(song, token);
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await waitBeforeLyricsRetry(attempt);
      }
    }
    if (!data) {
      counts.failed += 1;
      failures.push(`${song.title}: ${lastError?.message || 'không rõ lỗi'}`);
    } else if (data.status === 'saved' || data.status === 'skipped') {
      counts[data.status] += 1;
    } else if (data.status === 'display_only') {
      counts.displayOnly += 1;
    } else if (data.status === 'link_only') {
      counts.linkOnly += 1;
    } else if (data.status === 'needs_verification') {
      counts.verify += 1;
    } else {
      counts.failed += 1;
      failures.push(`${song.title}: ${data.reason || data.status || 'không tìm thấy'}`);
    }
    progress.value = index + 1;
  }
  button.disabled = false;
  progressText.textContent = `Đã xử lý ${songs.length}/${songs.length} bài.`;
  resultBox.hidden = false;
  resultBox.innerHTML = [
    `Lưu offline: <strong>${counts.saved}</strong>`,
    `Đã bỏ qua: <strong>${counts.skipped}</strong>`,
    `Chỉ hiển thị online: <strong>${counts.displayOnly}</strong>`,
    `Có liên kết nguồn: <strong>${counts.linkOnly}</strong>`,
    `Cần xác minh: <strong>${counts.verify}</strong>`,
    `Thất bại: <strong>${counts.failed}</strong>`,
    failures.length ? `<details><summary>Xem lỗi</summary><ul>${failures.slice(0, 12).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>` : ''
  ].filter(Boolean).join(' · ');
}

async function loadKaraokeSyncStatus() {
  const status = $('#karaokeSyncProviderStatus');
  if (!status) return;
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    const data = await response.json();
    if (!data.lyricsProviderConfigured) {
      status.textContent = data.lyricsLinkFallback ? 'Chưa có API · có fallback nguồn link' : 'Chưa cấu hình API lyrics';
      status.classList.add('is-warning');
      return;
    }
    status.textContent = data.lyricsPersistenceAllowed ? 'API + lưu offline' : 'API · chỉ online';
    status.classList.toggle('is-warning', !data.lyricsPersistenceAllowed);
  } catch {
    status.textContent = 'Không kết nối được server';
    status.classList.add('is-warning');
  }
}

function renderKaraokeLyricsLines() {
  const session = state.karaokeLyricsModal;
  const view = $('#karaokeLyricsText');
  if (!view) return;
  const wordLines = Array.isArray(session.wordSyncLines) ? session.wordSyncLines : [];
  const parsedSyncedLines = parseSyncedKaraokeLyrics(session.syncedLyrics);
  const wordTimedLines = wordLines.length
    ? wordLines.map((line) => ({ seconds: Number(line?.startMs) / 1000, text: line?.text || (Array.isArray(line?.words) ? line.words.map((word) => word?.text || '').join('') : '') }))
    : [];
  const audio = $('#karaokeAudioElement');
  const lineTimeline = karaokeLyricsLineTimeline(session, audio);
  const timingVerified = lineTimeline.verified;
  const timeline = lineTimeline.lines;
  const sourceLines = timingVerified && wordLines.length ? wordTimedLines : parsedSyncedLines;
  const syncedLines = timingVerified && (wordLines.length || parsedSyncedLines.length)
    ? sourceLines
    : lineTimeline.estimated && session.source === 'user-lrc' && parsedSyncedLines.length
      ? parsedSyncedLines
    : [];
  const lines = syncedLines.length
    ? syncedLines.map((line) => line.text)
    : session.text.replace(/\r\n?/g, '\n').split('\n');
  const languageMarkers = new Map();
  if (session.songId === 'hanh-phuc-moi' && lines.length) {
    languageMarkers.set(0, 'Tiếng Hàn · phiên âm Latin');
    const vietnameseStart = lines.findIndex((line, index) => index > 0 && /^nhưng giờ đây\b/i.test(line.trim()));
    if (vietnameseStart > 0) languageMarkers.set(vietnameseStart, 'Tiếng Việt');
  }
  const canSeek = timingVerified && state.karaokeAudio.songId === session.songId && Number.isFinite(audio?.duration) && audio.duration > 0;
  view.innerHTML = lines.map((line, index) => {
    const languageMarker = languageMarkers.has(index)
      ? `<div class="lyrics-language-label">${escapeHtml(languageMarkers.get(index))}</div>`
      : '';
    if (!line.trim()) return `${languageMarker}<div class="lyrics-line-spacer" aria-hidden="true"></div>`;
    const section = !syncedLines.length && line.trim().match(/^\[(verse|chorus|pre-chorus|bridge|điệp khúc|đoạn)\s*([^\]]*)\]$/i);
    if (section) {
      const label = `${section[1]}${section[2] ? ` ${section[2].trim()}` : ''}`;
      return `${languageMarker}<div class="lyrics-section-label">${escapeHtml(label)}</div>`;
    }
    const hidden = session.studyMode && session.hiddenLines.has(index);
    const important = session.importantLines.has(index);
    const wordLine = wordLines[index];
    const timelineIndex = timeline.findIndex((timed) => timed.sourceIndex === index);
    const timedLine = timelineIndex >= 0 ? timeline[timelineIndex] : null;
    const hasLineTiming = Boolean(timedLine);
    const seekTime = timingVerified
      ? wordLines.length ? Number(wordLine?.startMs) / 1000 : Number(syncedLines[index]?.seconds)
      : Number.NaN;
    const hasSeekTime = Number.isFinite(seekTime) && seekTime >= 0;
    const lineData = hasLineTiming
      ? ` data-synced-lyric-index="${timelineIndex}" data-lyric-time="${timedLine.start}"${lineTimeline.estimated ? ' data-lyric-timing="estimated"' : ''}`
      : '';
    const timedClass = hasLineTiming ? ' is-timed' : '';
    const lineContent = escapeHtml(line);
    return `
      ${languageMarker}<div class="lyrics-line-row${important ? ' is-important' : ''}${timedClass}"${lineData}>
        <button class="lyrics-line${hidden ? ' is-hidden' : ''}" type="button" data-lyrics-line="${index}" aria-label="${hidden ? 'Hiện dòng lời bài hát' : `${hasSeekTime ? `Tua đến ${formatKaraokeTime(seekTime)}: ` : ''}${escapeHtml(line)}`}"${hasSeekTime ? ` data-lyric-time="${seekTime}"${!canSeek ? ' disabled' : ''}` : ''}>
          ${hidden ? '••• Nhấn để hiện dòng •••' : lineContent}
        </button>
        <button class="lyrics-mark-button${important ? ' is-active' : ''}" type="button" data-lyrics-mark="${index}" aria-label="${important ? 'Bỏ đánh dấu dòng' : 'Đánh dấu dòng quan trọng'}">${important ? '★' : '☆'}</button>
      </div>
    `;
  }).join('');
  updateKaraokeSyncedLyrics({ refreshRows: true });
}

function renderKaraokeLyricsModal() {
  const modal = $('#karaokeLyricsModal');
  const song = currentKaraokeLyricsSong();
  if (!modal || !song) return;
  const session = state.karaokeLyricsModal;
  const syncedLines = parseSyncedKaraokeLyrics(session.syncedLyrics);
  const hasLyrics = Boolean(session.text.trim() || syncedLines.length || (Array.isArray(session.wordSyncLines) && session.wordSyncLines.length));
  const status = $('#karaokeLyricsStatus');
  const view = $('#karaokeLyricsText');
  const empty = $('#karaokeLyricsEmpty');
  const editor = $('#karaokeLyricsEditor');
  const textarea = $('#karaokeLyricsInput');
  const studyTools = $('#karaokeStudyTools');
  const studyToggle = $('#toggleLyricsStudy');
  const fullscreenToggle = $('#toggleLyricsFullscreen');
  const alignToggle = $('#toggleLyricsAlign');
  const fontSizeValue = $('#lyricsFontSizeValue');
  const sourceLink = $('#openKaraokeLyricsSource');

  $('#karaokeLyricsTitle').textContent = song.title;
  $('#karaokeLyricsTitle').classList.toggle('is-long-title', song.title.length > 38);
  $('#exitKaraokeMode').hidden = !session.karaokeActive;
  const metadata = session.metadata || {};
  const artist = metadata.artist || song.artist || song.composer || 'Chưa có thông tin ca sĩ / nhạc sĩ';
  $('#karaokeLyricsArtist').textContent = artist;
  const cover = $('#karaokeCoverArt');
  if (metadata.coverUrl) cover.src = metadata.coverUrl;
  else cover.removeAttribute('src');
  cover.hidden = !metadata.coverUrl;
  $('#karaokeAlbumMeta').textContent = [metadata.album, metadata.year, metadata.durationSeconds ? formatKaraokeTime(metadata.durationSeconds) : ''].filter(Boolean).join(' · ');
  $('#karaokeLyricsCategory').textContent = karaokeCategoryLabel(song.category);
  sourceLink.hidden = !session.sourceUrl || session.loading || session.editing;
  sourceLink.href = session.sourceUrl || '#';
  sourceLink.textContent = session.sourceName ? `${session.sourceName} ↗` : 'Mở nguồn lời bài hát ↗';
  modal.classList.toggle('is-fullscreen', session.fullscreen);
  modal.classList.toggle('is-karaoke-mode', session.karaokeActive);
  modal.style.setProperty('--lyrics-font-size', `${session.karaokeActive ? Math.min(session.fontSize, 17) : session.fontSize}px`);
  view.classList.toggle('is-left', session.align === 'left');
  if (fontSizeValue) fontSizeValue.textContent = `${session.fontSize}px`;
  if (alignToggle) {
    alignToggle.textContent = session.align === 'left' ? 'Căn giữa' : 'Căn trái';
    alignToggle.setAttribute('aria-label', session.align === 'left' ? 'Căn giữa lời bài hát' : 'Căn trái lời bài hát');
  }
  if (studyToggle) {
    studyToggle.classList.toggle('is-active', session.studyMode);
    studyToggle.setAttribute('aria-pressed', String(session.studyMode));
    studyToggle.textContent = session.studyMode ? '🧠 Đang học thuộc' : '🧠 Học thuộc';
  }
  if (fullscreenToggle) {
    fullscreenToggle.textContent = session.fullscreen ? '↙ Thu nhỏ' : '⛶ Toàn màn hình';
    fullscreenToggle.setAttribute('aria-pressed', String(session.fullscreen));
  }

  const hasLanguageNote = session.songId === 'hanh-phuc-moi' && hasLyrics && !session.editing;
  const audio = $('#karaokeAudioElement');
  const timingVerified = karaokeLyricsTimingMatchesAudio(session, audio);
  const lineTimeline = karaokeLyricsLineTimeline(session, audio);
  const hasTiming = Boolean(session.wordSyncLines?.length || parseSyncedKaraokeLyrics(session.syncedLyrics).length);
  if (session.loading) status.textContent = 'Đang tải lời bài hát…';
  else if (session.error) status.textContent = 'Không đọc được file lời bài hát';
  else if (!hasLyrics) status.textContent = 'Bài hát này chưa có lời';
  else if (session.studyMode) status.textContent = 'Chế độ học thuộc';
  else if (hasLanguageNote) status.textContent = 'Đoạn mở đầu là tiếng Hàn viết bằng phiên âm Latin; phần sau là lời tiếng Việt.';
  else if (lineTimeline.estimated) status.textContent = 'Đồng bộ ước lượng theo từng dòng và thời lượng bài; có thể lệch.';
  else if (timingVerified && session.wordSyncLines?.length) status.textContent = 'Lời đang tô sáng theo từng dòng; thời điểm có thể lệch nhẹ.';
  else if (timingVerified && parseSyncedKaraokeLyrics(session.syncedLyrics).length) status.textContent = session.source === 'zing-lrc'
    ? 'LRC từ Zing MP3 khớp lời và thời lượng; tô sáng theo từng dòng.'
    : 'Lời LRC khớp bản nhạc; tô sáng theo từng dòng, thời điểm có thể lệch nhẹ.';
  else if (hasTiming && ['lrclib', 'zing-lrc'].includes(session.source) && session.providerTrackId && session.durationSeconds && audio?.currentSrc && Number.isFinite(audio.duration)) status.textContent = 'Bản audio không khớp thời lượng lời; đang hiển thị lời tĩnh.';
  else status.textContent = 'Lời bài hát chưa có đồng bộ thời gian.';
  status.hidden = !session.loading && !session.error && !session.studyMode && !hasLanguageNote && !hasLyrics;

  view.hidden = session.loading || !hasLyrics || session.editing;
  empty.hidden = session.loading || hasLyrics || session.editing;
  editor.hidden = !session.editing;
  studyTools.hidden = session.loading || !hasLyrics || !session.studyMode;
  if (session.editing && document.activeElement !== textarea) textarea.value = session.text;
  if (session.editing && hasLyrics) view.hidden = false;
  renderKaraokeAudioControls();
  if (hasLyrics) renderKaraokeLyricsLines();
}

function closeKaraokeLyrics() {
  const modal = $('#karaokeLyricsModal');
  if (!modal) return;
  window.clearTimeout(karaokeNextTrackTimer);
  karaokeNextTrackTimer = 0;
  karaokeJudgeRequestId += 1;
  $('#karaokeJudgeButton').disabled = false;
  $('#karaokeScorePopup').hidden = true;
  if (karaokeJudgeSession) finishKaraokeJudge();
  resetKaraokeAudio();
  state.karaokeLyricsModal.requestId = `${state.karaokeLyricsModal.songId || 'closed'}:${Date.now()}`;
  modal.hidden = true;
  document.body.classList.remove('karaoke-modal-open');
  state.karaokeLyricsModal.fullscreen = false;
}

function karaokeQueueForSong(songId) {
  const inAdmin = $('#adminScreen')?.hidden === false;
  let songs;
  if (inAdmin) songs = UNIQUE_KARAOKE_SONGS;
  else if (state.karaokeShowSelected) songs = UNIQUE_KARAOKE_SONGS.filter((song) => state.karaokeSelected.has(song.title));
  else songs = karaokeSongsForView();
  if (!songs.some((song) => song.songId === songId)) songs = UNIQUE_KARAOKE_SONGS;
  return songs.map((song) => song.songId);
}

async function openKaraokeLyrics(songId, { continueQueue = false } = {}) {
  const modal = $('#karaokeLyricsModal');
  const song = UNIQUE_KARAOKE_SONGS.find((item) => item.songId === songId);
  if (!modal || !song) return;
  window.clearTimeout(karaokeNextTrackTimer);
  karaokeNextTrackTimer = 0;
  if (!continueQueue) state.karaokePlaybackQueue = karaokeQueueForSong(songId);
  if (karaokeJudgeSession) await finishKaraokeJudge();
  $('#karaokeScorePopup').hidden = true;
  $('#karaokeJudgeCaption').textContent = 'Nhấn bắt đầu để mở nhạc nền đã giảm giọng ca sĩ và chạy lời theo nhạc.';
  $('#karaokeJudgeCaption').hidden = true;
  $('#karaokeJudgeButton').textContent = '🎙️ Bắt đầu hát karaoke';
  $('#karaokeJudgeTimer').textContent = '';
  const session = state.karaokeLyricsModal;
  karaokeLyricsFollowPaused = false;
  $('#karaokeLyricsFollow')?.setAttribute('hidden', '');
  const stored = karaokeLyricsForSong(song);
  const savedUi = lyricsUiForSong(song.songId);
  const requestId = `${song.songId}:${Date.now()}`;
  const resumeKaraoke = continueQueue && state.karaokeLyricsModal.karaokeActive;
  session.karaokeActive = resumeKaraoke;
  if (karaokeVocalGraph) setKaraokeVocalMix(resumeKaraoke);
  if (!resumeKaraoke) $('#karaokeVocalStatus').textContent = 'Đang phát bản gốc · nhấn bắt đầu khi muốn hát karaoke.';
  prepareKaraokeAudio(song.songId, true);
  session.songId = song.songId;
  session.text = stored?.text || '';
  session.syncedLyrics = stored?.syncedLyrics || '';
  session.wordSyncLines = stored?.wordSyncLines || [];
  session.source = stored?.source || '';
  session.durationSeconds = stored?.durationSeconds || null;
  session.metadata = null;
  session.providerTrackId = stored?.providerTrackId || '';
  session.loading = !session.text;
  session.error = false;
  session.sourceUrl = '';
  session.sourceName = stored?.source === 'user-lrc' ? 'LRC có timestamp' : stored?.source === 'user-input' ? 'Lời tự nhập' : stored?.source || '';
  session.editing = false;
  session.studyMode = savedUi.studyMode;
  session.hiddenLines = savedUi.hiddenLines;
  session.importantLines = savedUi.importantLines;
  session.requestId = requestId;
  modal.hidden = false;
  $('#karaokeAudioPanel').hidden = false;
  $('#karaokeLyricsBody').hidden = false;
  document.body.classList.add('karaoke-modal-open');
  $('#closeKaraokeLyrics')?.focus();
  renderKaraokeLyricsModal();
  fetch(`/api/karaoke/metadata/${encodeURIComponent(song.songId)}`, { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : null)
    .then((metadata) => { if (metadata?.ok && session.requestId === requestId) { session.metadata = metadata; renderKaraokeLyricsModal(); } })
    .catch(() => {});
  if (stored?.text) {
    if (!karaokeSessionHasTimestamps(session)) refreshKaraokeTimedLyrics(song, requestId);
    return;
  }
  const serverLyrics = await fetchStoredKaraokeLyrics(song);
  if (session.requestId !== requestId) return;
  if (serverLyrics?.lyrics) {
    session.text = serverLyrics.lyrics;
    session.syncedLyrics = serverLyrics.syncedLyrics || '';
    session.wordSyncLines = serverLyrics.wordSyncLines || [];
    session.source = serverLyrics.source || '';
    session.durationSeconds = serverLyrics.durationSeconds || null;
    session.providerTrackId = serverLyrics.providerTrackId || '';
    session.sourceName = serverLyrics.source || '';
    session.loading = false;
    session.error = false;
    renderKaraokeLyricsModal();
    if (!karaokeSessionHasTimestamps(session)) refreshKaraokeTimedLyrics(song, requestId);
    return;
  }
  try {
    const response = await fetch(`${KARAOKE_LYRICS_DIR}${encodeURIComponent(song.songId)}.txt`, { cache: 'no-store' });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || /text\/html/i.test(contentType)) throw new Error('lyrics-not-found');
    const text = await response.text();
    if (!text.trim()) throw new Error('lyrics-empty');
    if (session.requestId !== requestId) return;
    session.text = text;
    session.source = 'public-file';
    session.durationSeconds = null;
    session.loading = false;
    state.karaokeLyrics[song.songId] = { text, source: 'public-file', updatedAt: new Date().toISOString() };
    saveKaraokeLyrics();
    renderKaraokeLyricsModal();
    refreshKaraokeTimedLyrics(song, requestId);
    return;
  } catch {
    if (session.requestId !== requestId) return;
    session.loading = false;
    session.error = false;
  }
  const liveLyrics = await fetchLiveKaraokeLyrics(song);
  if (session.requestId !== requestId) return;
  if (liveLyrics?.lyrics) {
    session.text = liveLyrics.lyrics;
    session.syncedLyrics = liveLyrics.syncedLyrics || '';
    session.wordSyncLines = liveLyrics.wordSyncLines || [];
    session.source = liveLyrics.source || 'lrclib';
    session.durationSeconds = liveLyrics.durationSeconds || null;
    session.providerTrackId = liveLyrics.providerTrackId || '';
    session.sourceName = liveLyrics.sourceName || liveLyrics.source || '';
    session.sourceUrl = liveLyrics.sourceUrl || '';
    session.loading = false;
    session.error = false;
    renderKaraokeLyricsModal();
    return;
  }
  const adminToken = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (adminToken) {
    try {
      const synced = await syncKaraokeSongFromProvider(song, adminToken);
      if (session.requestId !== requestId) return;
      if (synced?.lyrics) {
        session.text = synced.lyrics;
        session.syncedLyrics = synced.syncedLyrics || '';
        session.wordSyncLines = synced.wordSyncLines || [];
        session.source = synced.source || '';
        session.durationSeconds = synced.durationSeconds || null;
        session.providerTrackId = synced.providerTrackId || '';
        session.loading = false;
        session.editing = false;
        renderKaraokeLyricsModal();
        return;
      }
      if (synced?.sourceUrl) {
        session.sourceUrl = synced.sourceUrl;
        session.sourceName = synced.sourceName || 'Mở nguồn lời bài hát';
      }
    } catch {
      // Keep the editor available when the provider is unavailable or needs configuration.
    }
  }
  if (!session.sourceUrl) {
    const source = await fetchKaraokeLyricsSource(song);
    if (session.requestId !== requestId) return;
    session.sourceUrl = source?.url || '';
    session.sourceName = source?.sourceName || '';
  }
  if (session.requestId !== requestId) return;
  session.loading = false;
  session.editing = true;
  renderKaraokeLyricsModal();
}

function karaokeCategoryLabel(categoryId) {
  return KARAOKE_CATEGORIES.find((category) => category.id === categoryId)?.label || 'Karaoke';
}

function karaokeSongFilterLabel(song) {
  if (state.karaokeCategory !== 'all') {
    const selectedFilter = KARAOKE_CATEGORIES.find((category) => category.id === state.karaokeCategory);
    if (selectedFilter?.id === song.show) return selectedFilter.label;
  }
  return karaokeCategoryLabel(song.category);
}

function renderKaraokeCategories() {
  const container = $('#karaokeCategories');
  if (!container) return;
  container.innerHTML = KARAOKE_CATEGORIES.map((category) => `
    <button class="karaoke-category-tab${state.karaokeCategory === category.id ? ' active' : ''}" type="button" role="tab" aria-selected="${state.karaokeCategory === category.id}" data-karaoke-category="${category.id}">
      <span>${category.emoji}</span>${category.label}
    </button>
  `).join('');
  container.querySelectorAll('[data-karaoke-category]').forEach((button) => button.addEventListener('click', () => {
    state.karaokeCategory = button.dataset.karaokeCategory;
    renderKaraoke();
  }));
}

function karaokeSongsForView() {
  const query = state.karaokeQuery.trim().toLocaleLowerCase();
  return UNIQUE_KARAOKE_SONGS.filter((song) => {
    const matchesCategory = state.karaokeCategory === 'all'
      || song.category === state.karaokeCategory
      || song.show === state.karaokeCategory;
    const matchesQuery = !query || song.title.toLocaleLowerCase().includes(query);
    const matchesSelected = !state.karaokeShowSelected || state.karaokeSelected.has(song.title);
    return matchesCategory && matchesQuery && matchesSelected;
  });
}

function renderKaraokeSelectedPanel() {
  const panel = $('#karaokeSelectedPanel');
  const list = $('#karaokeSelectedList');
  const hint = $('#karaokeSelectedHint');
  if (!panel || !list || !hint) return;
  const selectedSongs = UNIQUE_KARAOKE_SONGS.filter((song) => state.karaokeSelected.has(song.title));
  panel.hidden = !selectedSongs.length;
  hint.textContent = selectedSongs.length ? `${selectedSongs.length} bài · bấm × để bỏ` : 'Chưa chọn bài nào';
  list.innerHTML = selectedSongs.map((song) => `
    <button class="karaoke-selected-chip" type="button" data-remove-karaoke="${escapeHtml(song.title)}" title="Bỏ ${escapeHtml(song.title)}">
      <span>${escapeHtml(song.title)}</span><b aria-hidden="true">×</b>
    </button>
  `).join('');
  list.querySelectorAll('[data-remove-karaoke]').forEach((button) => button.addEventListener('click', () => {
    state.karaokeSelected.delete(button.dataset.removeKaraoke);
    saveKaraokeSelection();
    renderKaraoke();
  }));
}

function renderKaraoke() {
  const list = $('#karaokeList');
  if (!list) return;
  renderKaraokeCategories();
  const songs = karaokeSongsForView();
  const categoryLabel = state.karaokeShowSelected ? 'Đã chọn' : karaokeCategoryLabel(state.karaokeCategory);
  list.innerHTML = songs.map((song, index) => {
    const selected = state.karaokeSelected.has(song.title);
    return `
      <article class="karaoke-song-card${selected ? ' is-selected' : ''}" role="button" tabindex="0" data-karaoke-song-id="${escapeHtml(song.songId)}" aria-label="Xem lời bài ${escapeHtml(song.title)}" style="--karaoke-index:${index}">
        <button class="karaoke-song-check-button" type="button" data-select-karaoke="${escapeHtml(song.title)}" aria-label="${selected ? 'Bỏ chọn' : 'Chọn'} ${escapeHtml(song.title)}" aria-pressed="${selected}">
          <span class="karaoke-song-check" aria-hidden="true">${selected ? '✓' : ''}</span>
        </button>
        <span class="karaoke-artwork" aria-hidden="true">♫</span>
        <span class="karaoke-song-copy"><strong>${escapeHtml(song.title)}</strong><small>${escapeHtml(state.karaokeShowSelected ? karaokeSongFilterLabel(song) : categoryLabel)}</small></span>
        <span class="karaoke-song-action">Xem lời ↗</span>
      </article>
    `;
  }).join('');
  $('#karaokeEmpty').hidden = Boolean(songs.length);
  $('#karaokeCount').textContent = `${state.karaokeSelected.size} bài đã chọn`;
  $('#showKaraokeSelected').classList.toggle('is-active', state.karaokeShowSelected);
  $('#showKaraokeSelected').setAttribute('aria-pressed', String(state.karaokeShowSelected));
  $('#showKaraokeSelected').textContent = state.karaokeShowSelected ? '☷ Xem tất cả' : '♡ Đã chọn';
  renderKaraokeSelectedPanel();
  list.querySelectorAll('[data-karaoke-song-id]').forEach((card) => {
    const openLyrics = () => openKaraokeLyrics(card.dataset.karaokeSongId);
    card.addEventListener('click', openLyrics);
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openLyrics();
    });
  });
  list.querySelectorAll('[data-select-karaoke]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    const title = button.dataset.selectKaraoke;
    if (state.karaokeSelected.has(title)) state.karaokeSelected.delete(title);
    else state.karaokeSelected.add(title);
    saveKaraokeSelection();
    renderKaraoke();
  }));
}

function renderAdminKaraokeList() {
  const list = $('#adminKaraokeList');
  const empty = $('#adminKaraokeEmpty');
  if (!list || !empty) return;
  const query = ($('#adminKaraokeSearch')?.value || '').trim().toLocaleLowerCase();
  const songs = UNIQUE_KARAOKE_SONGS.filter((song) => !query || song.title.toLocaleLowerCase().includes(query));
  list.innerHTML = songs.map((song, index) => `
    <article class="karaoke-song-card" role="button" tabindex="0" data-admin-karaoke-song-id="${escapeHtml(song.songId)}" aria-label="Xem lời bài ${escapeHtml(song.title)}" style="--karaoke-index:${index}">
      <span class="karaoke-song-copy"><strong>${escapeHtml(song.title)}</strong><small>${escapeHtml(karaokeCategoryLabel(song.category))}</small></span>
      <span class="karaoke-song-action">Xem lời ↗</span>
    </article>
  `).join('');
  empty.hidden = songs.length > 0;
  list.querySelectorAll('[data-admin-karaoke-song-id]').forEach((card) => {
    const openLyrics = () => openKaraokeLyrics(card.dataset.adminKaraokeSongId);
    card.addEventListener('click', openLyrics);
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openLyrics();
    });
  });
}

function toggleAllKaraokeLyricsLines(shouldHide) {
  const session = state.karaokeLyricsModal;
  const syncedLines = parseSyncedKaraokeLyrics(session.syncedLyrics);
  const lines = syncedLines.length ? syncedLines.map((line) => line.text) : session.text.replace(/\r\n?/g, '\n').split('\n');
  session.hiddenLines = shouldHide
    ? new Set(lines.map((line, index) => line.trim() && !/^\[(verse|chorus|pre-chorus|bridge|điệp khúc|đoạn)\b/i.test(line.trim()) ? index : null).filter((index) => index !== null))
    : new Set();
  session.studyMode = shouldHide || session.studyMode;
  saveKaraokeLyricsUi();
  renderKaraokeLyricsModal();
}

function saveEditedKaraokeLyrics() {
  const song = currentKaraokeLyricsSong();
  const textarea = $('#karaokeLyricsInput');
  const status = $('#karaokeLyricsStatus');
  if (!song || !textarea || !status) return;
  const text = textarea.value.replace(/\r\n?/g, '\n').trim();
  if (!text) {
    status.textContent = 'Bạn hãy nhập lời bài hát trước khi lưu.';
    textarea.focus();
    return;
  }
  const syncedLines = parseSyncedKaraokeLyrics(text);
  const isLrc = syncedLines.length >= 2;
  const lyricsText = isLrc ? syncedLines.map((line) => line.text).join('\n') : text;
  state.karaokeLyrics[song.songId] = {
    text: lyricsText,
    syncedLyrics: isLrc ? text : '',
    source: isLrc ? 'user-lrc' : 'user-input',
    updatedAt: new Date().toISOString()
  };
  saveKaraokeLyrics();
  state.karaokeLyricsModal.text = lyricsText;
  state.karaokeLyricsModal.syncedLyrics = isLrc ? text : '';
  state.karaokeLyricsModal.wordSyncLines = [];
  state.karaokeLyricsModal.source = isLrc ? 'user-lrc' : 'user-input';
  state.karaokeLyricsModal.durationSeconds = null;
  state.karaokeLyricsModal.providerTrackId = '';
  state.karaokeLyricsModal.sourceName = isLrc ? 'LRC có timestamp' : 'Lời tự nhập';
  state.karaokeLyricsModal.editing = false;
  state.karaokeLyricsModal.error = false;
  state.karaokeLyricsModal.hiddenLines = new Set();
  state.karaokeLyricsModal.importantLines = new Set();
  saveKaraokeLyricsUi();
  renderKaraokeLyricsModal();
  showToast(isLrc ? 'Đã lưu lời LRC đồng bộ theo dòng trên thiết bị này 💗' : 'Đã lưu lời bài hát trên thiết bị này 💗');
}

function bindKaraoke() {
  const search = $('#karaokeSearch');
  const selectedToggle = $('#showKaraokeSelected');
  const clearButton = $('#clearKaraokeSelected');
  if (!search || !selectedToggle || !clearButton) return;
  $('#karaokeJudgeButton')?.addEventListener('click', () => {
    if (!state.karaokeLyricsModal.karaokeActive) beginKaraokeSession();
    else if (karaokeJudgeSession) finishKaraokeJudge();
    else startKaraokeJudge();
  });
  const audio = $('#karaokeAudioElement');
  if (audio) {
    setKaraokeAudioVolume($('#karaokeAudioVolume')?.value ?? 0.8);
    audio.addEventListener('loadedmetadata', () => {
      const current = state.karaokeAudio;
      if (!current.songId || current.songId !== state.karaokeLyricsModal.songId) return;
      const expectedDuration = Number(current.entry?.durationSeconds);
      if (Number.isFinite(expectedDuration) && expectedDuration > 0
        && Math.abs(audio.duration - expectedDuration) > Math.max(8, expectedDuration * 0.1)) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        current.status = 'error';
        current.message = 'Thời lượng audio không khớp manifest; đã chặn phát nhầm bài.';
      } else {
        current.status = 'ready';
        current.message = 'Sẵn sàng phát · nhấn nút để bắt đầu';
      }
      renderKaraokeAudioControls();
      renderKaraokeLyricsLines();
      updateKaraokeSyncedLyrics();
      renderKaraokeLyricsModal();
      if (current.autoPlay && state.karaokeLyricsModal.karaokeActive) enableKaraokeVocalReduction(true);
    });
    audio.addEventListener('durationchange', () => {
      updateKaraokeSyncedLyrics();
      renderKaraokeLyricsModal();
    });
    audio.addEventListener('canplay', () => {
      const current = state.karaokeAudio;
      if (!current.songId || current.songId !== state.karaokeLyricsModal.songId || current.status === 'error') return;
      current.status = 'ready';
      current.message = 'Sẵn sàng phát · nhấn nút để bắt đầu';
      renderKaraokeAudioControls();
      renderKaraokeLyricsLines();
      updateKaraokeSyncedLyrics();
      if (current.autoPlay && state.karaokeLyricsModal.karaokeActive) enableKaraokeVocalReduction(true);
    });
    audio.addEventListener('playing', () => {
      const current = state.karaokeAudio;
      if (!current.songId || current.songId !== state.karaokeLyricsModal.songId) return;
      current.status = 'ready';
      current.message = 'Đang phát';
      renderKaraokeAudioControls();
      updateKaraokeSyncedLyrics();
      startKaraokeLyricsFrameLoop();
    });
    audio.addEventListener('waiting', () => {
      const current = state.karaokeAudio;
      if (!current.songId || current.songId !== state.karaokeLyricsModal.songId) return;
      current.status = 'buffering';
      current.message = 'Đang tải thêm audio…';
      renderKaraokeAudioControls();
    });
    audio.addEventListener('pause', () => {
      stopKaraokeLyricsFrameLoop();
      renderKaraokeAudioControls();
      updateKaraokeSyncedLyrics();
    });
    audio.addEventListener('seeking', () => { updateKaraokeSyncedLyrics(); renderKaraokeAudioControls(); });
    audio.addEventListener('seeked', () => { updateKaraokeSyncedLyrics(); renderKaraokeAudioControls(); });
    audio.addEventListener('timeupdate', () => {
      renderKaraokeAudioControls();
      updateKaraokeSyncedLyrics();
    });
    audio.addEventListener('ended', async () => {
      stopKaraokeLyricsFrameLoop();
      updateKaraokeSyncedLyrics();
      const endedSongId = state.karaokeLyricsModal.songId;
      const wasJudging = karaokeJudgeSession?.songId === endedSongId;
      state.karaokeAudio.status = 'ready';
      state.karaokeAudio.message = 'Đã phát xong';
      renderKaraokeAudioControls();
      if (wasJudging) await finishKaraokeJudge();
      const queue = state.karaokePlaybackQueue;
      const nextIndex = queue.indexOf(endedSongId) + 1;
      const nextSongId = nextIndex > 0 ? queue[nextIndex] : '';
      if (!nextSongId) return;
      const scorePopup = $('#karaokeScorePopup');
      const scoreVisible = wasJudging && scorePopup && !scorePopup.hidden;
      state.karaokeAudio.message = 'Bài tiếp theo sẽ tự phát…';
      renderKaraokeAudioControls();
      karaokeNextTrackTimer = window.setTimeout(() => {
        karaokeNextTrackTimer = 0;
        if (state.karaokeLyricsModal.songId !== endedSongId || $('#karaokeLyricsModal')?.hidden) return;
        openKaraokeLyrics(nextSongId, { continueQueue: true });
      }, scoreVisible ? 5000 : 350);
    });
    audio.addEventListener('error', () => {
      stopKaraokeLyricsFrameLoop();
      const current = state.karaokeAudio;
      if (!current.songId || current.songId !== state.karaokeLyricsModal.songId || !audio.currentSrc) return;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      current.status = 'error';
      current.message = 'Audio lỗi hoặc định dạng không được trình duyệt hỗ trợ.';
      renderKaraokeAudioControls();
      updateKaraokeSyncedLyrics();
      renderKaraokeLyricsModal();
    });
    audio.addEventListener('emptied', () => {
      stopKaraokeLyricsFrameLoop();
      updateKaraokeSyncedLyrics();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') updateKaraokeSyncedLyrics();
    });
  }
  $('#karaokeAudioPlay')?.addEventListener('click', async () => {
    if (!audio || state.karaokeAudio.status !== 'ready' && state.karaokeAudio.status !== 'buffering') return;
    if (audio.paused) {
      try {
        state.karaokeAudio.autoPlay = false;
        if (state.karaokeLyricsModal.karaokeActive && !karaokeVocalGraph) await enableKaraokeVocalReduction(true);
        if (state.karaokeLyricsModal.karaokeActive && !karaokeVocalGraph) return;
        if (karaokeVocalGraph?.context.state === 'suspended') await karaokeVocalGraph.context.resume();
        await audio.play();
      } catch {
        state.karaokeAudio.status = 'error';
        state.karaokeAudio.message = 'Trình duyệt từ chối phát audio. Hãy nhấn phát lại.';
        renderKaraokeAudioControls();
      }
    } else audio.pause();
  });
  $('#karaokeAudioSeek')?.addEventListener('input', (event) => {
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Number(event.target.value);
    updateKaraokeSyncedLyrics();
    renderKaraokeAudioControls();
  });
  $('#karaokeAudioVolume')?.addEventListener('input', (event) => {
    setKaraokeAudioVolume(event.target.value);
  });
  $('#closeKaraokeLyrics')?.addEventListener('click', closeKaraokeLyrics);
  $('#exitKaraokeMode')?.addEventListener('click', async () => {
    if (karaokeJudgeSession) await finishKaraokeJudge();
    state.karaokeLyricsModal.karaokeActive = false;
    if (karaokeVocalGraph) setKaraokeVocalMix(false);
    $('#karaokeJudgeButton').textContent = '🎙️ Bắt đầu hát karaoke';
    $('#karaokeJudgeCaption').hidden = true;
    renderKaraokeLyricsModal();
  });
  $('#closeKaraokeScorePopup')?.addEventListener('click', closeKaraokeScorePopup);
  $('#doneKaraokeScorePopup')?.addEventListener('click', closeKaraokeScorePopup);
  $('#karaokeScorePopup')?.addEventListener('click', (event) => {
    if (event.target.id === 'karaokeScorePopup') closeKaraokeScorePopup();
  });
  $('#karaokeLyricsFollow')?.addEventListener('click', () => {
    karaokeLyricsFollowPaused = false;
    $('#karaokeLyricsFollow').hidden = true;
    state.karaokeAudio.activeLineIndex = -1;
    updateKaraokeSyncedLyrics();
  });
  $('#karaokeLyricsBody')?.addEventListener('scroll', () => {
    if (Date.now() < karaokeLyricsProgrammaticScrollUntil) return;
    karaokeLyricsFollowPaused = true;
    $('#karaokeLyricsFollow').hidden = false;
  }, { passive: true });
  const pauseLyricsFollow = () => {
    karaokeLyricsFollowPaused = true;
    $('#karaokeLyricsFollow').hidden = false;
  };
  ['wheel', 'touchstart', 'pointerdown'].forEach((eventName) => {
    $('#karaokeLyricsBody')?.addEventListener(eventName, pauseLyricsFollow, { passive: true });
  });
  const lyricsModal = $('#karaokeLyricsModal');
  lyricsModal?.addEventListener('click', (event) => {
    if (event.target.id === 'karaokeLyricsModal') {
      closeKaraokeLyrics();
      return;
    }
    const line = event.target.closest('[data-lyrics-line]');
    if (line) {
      const lineTime = Number(line.dataset.lyricTime);
      if (Number.isFinite(lineTime) && audio && state.karaokeAudio.songId === state.karaokeLyricsModal.songId && Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(lineTime, audio.duration);
        updateKaraokeSyncedLyrics();
        renderKaraokeAudioControls();
      }
      if (!state.karaokeLyricsModal.studyMode) return;
      const lineIndex = Number(line.dataset.lyricsLine);
      if (state.karaokeLyricsModal.hiddenLines.has(lineIndex)) state.karaokeLyricsModal.hiddenLines.delete(lineIndex);
      else state.karaokeLyricsModal.hiddenLines.add(lineIndex);
      saveKaraokeLyricsUi();
      renderKaraokeLyricsModal();
      return;
    }
    const mark = event.target.closest('[data-lyrics-mark]');
    if (mark) {
      const lineIndex = Number(mark.dataset.lyricsMark);
      if (state.karaokeLyricsModal.importantLines.has(lineIndex)) state.karaokeLyricsModal.importantLines.delete(lineIndex);
      else state.karaokeLyricsModal.importantLines.add(lineIndex);
      saveKaraokeLyricsUi();
      renderKaraokeLyricsModal();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || $('#karaokeLyricsModal')?.hidden) return;
    if (!$('#karaokeScorePopup')?.hidden) closeKaraokeScorePopup();
    else closeKaraokeLyrics();
  });
  $('#editKaraokeLyrics')?.addEventListener('click', () => {
    state.karaokeLyricsModal.editing = true;
    renderKaraokeLyricsModal();
    $('#karaokeLyricsInput')?.focus();
  });
  $('#addKaraokeLyrics')?.addEventListener('click', () => {
    state.karaokeLyricsModal.editing = true;
    renderKaraokeLyricsModal();
    $('#karaokeLyricsInput')?.focus();
  });
  $('#cancelKaraokeLyricsEdit')?.addEventListener('click', () => {
    state.karaokeLyricsModal.editing = false;
    renderKaraokeLyricsModal();
  });
  $('#saveKaraokeLyrics')?.addEventListener('click', saveEditedKaraokeLyrics);
  $('#toggleLyricsStudy')?.addEventListener('click', () => {
    state.karaokeLyricsModal.studyMode = !state.karaokeLyricsModal.studyMode;
    saveKaraokeLyricsUi();
    renderKaraokeLyricsModal();
  });
  $('#hideAllLyrics')?.addEventListener('click', () => toggleAllKaraokeLyricsLines(true));
  $('#showAllLyrics')?.addEventListener('click', () => toggleAllKaraokeLyricsLines(false));
  $('#increaseLyricsFont')?.addEventListener('click', () => {
    state.karaokeLyricsModal.fontSize = Math.min(34, state.karaokeLyricsModal.fontSize + 2);
    saveKaraokeLyricsPrefs();
    renderKaraokeLyricsModal();
  });
  $('#decreaseLyricsFont')?.addEventListener('click', () => {
    state.karaokeLyricsModal.fontSize = Math.max(14, state.karaokeLyricsModal.fontSize - 2);
    saveKaraokeLyricsPrefs();
    renderKaraokeLyricsModal();
  });
  $('#toggleLyricsAlign')?.addEventListener('click', () => {
    state.karaokeLyricsModal.align = state.karaokeLyricsModal.align === 'left' ? 'center' : 'left';
    saveKaraokeLyricsPrefs();
    renderKaraokeLyricsModal();
  });
  $('#toggleLyricsFullscreen')?.addEventListener('click', () => {
    state.karaokeLyricsModal.fullscreen = !state.karaokeLyricsModal.fullscreen;
    renderKaraokeLyricsModal();
  });
  $('#syncKaraokeLyrics')?.addEventListener('click', syncKaraokeLibrary);
  $('#preloadKaraokeLyrics')?.addEventListener('click', preloadKaraokeLyricsLibrary);
  search.addEventListener('input', () => {
    state.karaokeQuery = search.value;
    renderKaraoke();
  });
  $('#adminKaraokeSearch')?.addEventListener('input', renderAdminKaraokeList);
  renderAdminKaraokeList();
  selectedToggle.addEventListener('click', () => {
    state.karaokeShowSelected = !state.karaokeShowSelected;
    if (state.karaokeShowSelected) {
      state.karaokeCategory = 'all';
      state.karaokeQuery = '';
      search.value = '';
    }
    renderKaraoke();
  });
  clearButton.addEventListener('click', () => {
    if (!state.karaokeSelected.size) return;
    state.karaokeSelected.clear();
    saveKaraokeSelection();
    state.karaokeShowSelected = false;
    renderKaraoke();
    showToast('Đã bỏ toàn bộ bài karaoke đã chọn.');
  });
  renderKaraoke();
  loadKaraokeSyncStatus();
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
      headers: sessionHeaders('vy', { 'Content-Type': 'application/json' }),
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
    const headers = sessionHeaders(viewerRole, { 'Content-Type': 'application/json' });
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
  state.authenticatedRole = null;
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
  const token = sessionToken(viewerRole);
  if (!token) return;
  state.chatLoading = true;
  const status = viewerRole === 'admin' ? $('#adminChatStatus') : $('#chatStatus');
  try {
    const headers = sessionHeaders(viewerRole);
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
    const token = sessionToken(senderRole);
  button.disabled = true;
  try {
    status.textContent = file ? 'Đang chuẩn bị ảnh để gửi nha…' : '';
    const imageDataUrl = file ? await prepareChatImage(file) : '';
    const headers = sessionHeaders(senderRole, { 'Content-Type': 'application/json' });
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
    if (event.target.closest('.call-controls, .call-shortcuts, .call-tool-sheet, .call-filters, .call-mini-chat, .call-close, .call-incoming, button')) return;
    if (closeCallPanels(role)) {
      showCallControls(role, true);
      return;
    }
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

function closeCallPanels(role) {
  const elements = callElements(role);
  const panels = [elements.filters, elements.toolSheet, elements.miniChat];
  const wasOpen = panels.some((panel) => panel && !panel.hidden);
  if (elements.filters) {
    elements.filters.hidden = true;
    elements.filters.style.display = 'none';
    elements.filters.classList.remove('is-open');
  }
  if (elements.toolSheet) elements.toolSheet.hidden = true;
  if (elements.miniChat) elements.miniChat.hidden = true;
  elements.shortcuts?.querySelectorAll('[data-call-tool]').forEach((button) => button.classList.remove('active'));
  elements.filterToggle?.setAttribute('aria-expanded', 'false');
  return wasOpen;
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
    setCallVideoSource(role, true).catch(() => {});
    pipeline.backgroundMode = pipeline.backgroundMode === 'blur' ? 'none' : 'blur';
    elements.stage.classList.toggle('is-ios-effect-fallback', pipeline.backgroundMode === 'blur' && !isCanvasCallTrackReliable());
    elements.stage.classList.toggle('is-background-blurred', pipeline.backgroundMode === 'blur');
    setCallStatus(role, pipeline.backgroundMode === 'blur' ? 'Đã bật làm mờ phông nền.' : 'Đã tắt làm mờ phông nền.');
  } else if (tool === 'edit') {
    if (!pipeline) return setCallStatus(role, 'Camera chưa sẵn sàng để chỉnh sửa nha.');
    setCallVideoSource(role, true).catch(() => {});
    pipeline.editEnabled = !pipeline.editEnabled;
    elements.stage.classList.toggle('is-ios-effect-fallback', pipeline.editEnabled && !isCanvasCallTrackReliable());
    elements.stage.classList.toggle('is-edited', pipeline.editEnabled);
    setCallStatus(role, pipeline.editEnabled ? 'Đã bật chỉnh sửa hình ảnh.' : 'Đã tắt chỉnh sửa hình ảnh.');
  }
}

function applyCallBackground(role, presetId) {
  const preset = CALL_BACKGROUND_PRESETS.find((item) => item.id === presetId) || CALL_BACKGROUND_PRESETS[0];
  const pipeline = activeFilterPipeline?.role === role ? activeFilterPipeline : null;
  if (!pipeline) return setCallStatus(role, 'Camera chưa sẵn sàng để đổi phông nền nha.');
  setCallVideoSource(role, true).catch(() => {});
  pipeline.backgroundPreset = preset.id;
  pipeline.backgroundMode = preset.id === 'none' ? 'none' : 'replace';
  const elements = callElements(role);
  elements.stage.dataset.background = preset.id;
  elements.stage.classList.toggle('is-ios-effect-fallback', preset.id !== 'none' && !isCanvasCallTrackReliable());
  setCallStatus(role, preset.id === 'none' ? 'Đã dùng phông nền gốc.' : `Đã chọn phông nền ${preset.label}.`);
}

function applyCallColor(role, presetId) {
  const preset = CALL_COLOR_PRESETS.find((item) => item.id === presetId) || CALL_COLOR_PRESETS[0];
  const pipeline = activeFilterPipeline?.role === role ? activeFilterPipeline : null;
  if (!pipeline) return setCallStatus(role, 'Camera chưa sẵn sàng để đổi màu nha.');
  setCallVideoSource(role, true).catch(() => {});
  pipeline.colorFilter = preset.id;
  const elements = callElements(role);
  elements.stage.dataset.color = preset.id;
  elements.stage.classList.toggle('is-ios-effect-fallback', preset.id !== 'none' && !isCanvasCallTrackReliable());
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
  elements.stage.classList.toggle('is-ios-effect-fallback', filter !== 'none' && !isCanvasCallTrackReliable());
  if (activeFilterPipeline?.role === role) {
    activeFilterPipeline.filter = filter;
    setCallVideoSource(role, filter !== 'none').catch(() => {});
  }
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

function isIosCallDevice() {
  const userAgent = navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isCanvasCallTrackReliable() {
  return !isIosCallDevice();
}

async function setCallVideoSource(role, useCanvas) {
  const pipeline = activeFilterPipeline?.role === role ? activeFilterPipeline : null;
  if (!pipeline?.localVideoTrack || !pipeline.canvasStream) return false;
  if (useCanvas && !isCanvasCallTrackReliable()) {
    pipeline.usingCanvas = false;
    callElements(role).stage.classList.add('is-ios-effect-fallback');
    setCallStatus(role, 'iPhone đang giữ camera gốc để không mất hình nha.');
    return false;
  }
  const targetTrack = useCanvas
    ? pipeline.canvasStream.getVideoTracks()[0]
    : pipeline.sourceStream.getVideoTracks()[0];
  if (!targetTrack || pipeline.localVideoTrack.mediaStreamTrack === targetTrack) return true;
  try {
    await pipeline.localVideoTrack.replaceTrack(targetTrack);
    pipeline.usingCanvas = useCanvas;
    const elements = callElements(role);
    elements.stage.classList.toggle('is-ios-effect-fallback', false);
    elements.stage.classList.toggle('has-face-filter', useCanvas && Boolean(pipeline.faceLandmarker));
    const localTile = elements.videos?.querySelector('.call-tile.is-local-preview');
    if (localTile && !elements.section.hidden) {
      attachCallTrack(role, pipeline.localVideoTrack, {
        identity: role === 'admin' ? 'anh' : 'vy',
        name: role === 'admin' ? 'Anh' : 'Vy'
      });
    }
    return true;
  } catch (error) {
    pipeline.usingCanvas = false;
    console.warn('Không đổi được nguồn video filter:', error.message);
    return false;
  }
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
  try {
    if (sourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && sourceVideo.videoWidth) {
      if (faceLandmarker && timestamp - pipeline.lastInferenceAt > 55 && sourceVideo.currentTime !== pipeline.lastVideoTime) {
        const result = faceLandmarker.detectForVideo(sourceVideo, timestamp);
        pipeline.lastInferenceAt = timestamp;
        pipeline.lastVideoTime = sourceVideo.currentTime;
        pipeline.faceLandmarks = result.faceLandmarks?.[0] || null;
      }
      drawCuteFaceEffect(pipeline, pipeline.faceLandmarks);
    }
  } catch (error) {
    pipeline.faceLandmarks = null;
    try { drawCallSource(pipeline, null); } catch { /* keep the animation loop alive */ }
    console.warn('Face filter tạm thời lỗi, đã dùng camera gốc:', error.message);
  }
  pipeline.animationFrame = requestAnimationFrame(renderFaceFilterFrame);
}

async function startFaceFilterPipeline(role, options = {}) {
  liveKitSDK ||= await (liveKitSDKPromise ||= import('livekit-client'));
  const { LocalAudioTrack, LocalVideoTrack } = liveKitSDK;
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
    usingCanvas: false,
    localVideoTrack: null,
    localAudioTrack: null
  };
  activeFilterPipeline = pipeline;
  const loadModel = async () => {
    try {
      if (!canvasStream) throw new Error('Thiết bị chưa hỗ trợ xuất video filter từ canvas.');
      pipeline.faceLandmarker = await loadFaceLandmarker();
      if (activeFilterPipeline === pipeline && pipeline.usingCanvas) elements.stage.classList.add('has-face-filter');
    } catch (error) {
      console.warn('Không tải được face filter, dùng camera nguyên bản:', error.message);
      if (activeFilterPipeline === pipeline && !elements.section.hidden) {
        setCallStatus(role, 'Filter khuôn mặt đang tải chậm, cuộc gọi vẫn tiếp tục nha.');
      }
    }
  };
  if (options.deferFaceModel) loadModel();
  else await loadModel();
  pipeline.localVideoTrack = new LocalVideoTrack(sourceStream.getVideoTracks()[0], { name: 'camera' });
  pipeline.localAudioTrack = new LocalAudioTrack(sourceStream.getAudioTracks()[0], { name: 'microphone' });
  elements.stage.classList.remove('has-face-filter');
  if (canvasStream) drawCuteFaceEffect(pipeline, null);
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
  if (track.kind === liveKitSDK?.Track.Kind.Video) {
    tile.querySelectorAll('video').forEach((element) => element.remove());
    const video = track.attach();
    video.className = 'call-video';
    video.autoplay = true;
    video.playsInline = true;
    video.muted = isLocal;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    tile.prepend(video);
    const startPlayback = () => { video.play().catch(() => {}); };
    video.addEventListener('loadedmetadata', startPlayback, { once: true });
    startPlayback();
  } else if (track.kind === liveKitSDK?.Track.Kind.Audio) {
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
    const token = sessionToken(role);
    if (!token) throw new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại trước khi gọi.');
    headers.Authorization = `Bearer ${token}`;
    const tokenResponse = await fetch('/api/livekit/token', {
      method: 'POST',
      headers,
      body: JSON.stringify({ role, announce, callType })
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (tokenResponse.status === 401) {
      if (role === 'admin') handleAdminSessionExpired();
      else { localStorage.removeItem(VY_TOKEN_KEY); setAuthenticated(false); }
      return;
    }
    if (!tokenResponse.ok) throw new Error(tokenData.error || 'Chưa mở được phòng video.');

    liveKitSDK ||= await (liveKitSDKPromise ||= import('livekit-client'));
    const { Room, RoomEvent, Track, VideoPresets } = liveKitSDK;

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
  if (pipeline.switchingCamera) return;
  const current = pipeline.facingMode || track.getSettings().facingMode || 'user';
  const next = current === 'environment' ? 'user' : 'environment';
  pipeline.switchingCamera = true;
  setCallStatus(role, 'Đang chuyển camera…');
  try {
    // Safari iOS can resolve applyConstraints() without producing a usable
    // frame. Always open a fresh track, then replace the LiveKit track only
    // after the new camera is confirmed live.
    let replacementStream;
    try {
      replacementStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: next }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
    } catch (error) {
      // Some Safari versions reject exact facingMode but expose camera labels
      // after permission has been granted. Select the matching device then.
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const currentDeviceId = track.getSettings?.().deviceId;
      const labelPattern = next === 'environment'
        ? /back|rear|environment|world|sau/i
        : /front|user|facetime|trước/i;
      const camera = devices.find((device) => device.kind === 'videoinput'
        && device.deviceId !== currentDeviceId
        && labelPattern.test(device.label || ''));
      if (!camera) throw error;
      replacementStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: camera.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
    }
    const nextTrack = replacementStream?.getVideoTracks?.()[0];
    const replacementFacingMode = nextTrack?.getSettings?.().facingMode;
    if (!nextTrack || nextTrack.readyState !== 'live'
      || (replacementFacingMode && replacementFacingMode !== next)) {
      replacementStream?.getTracks?.().forEach((replacement) => replacement.stop());
      throw new Error('Thiết bị không trả đúng camera được yêu cầu.');
    }

    const oldTrack = pipeline.sourceStream.getVideoTracks()[0];
    const audioTracks = pipeline.sourceStream.getAudioTracks();
    const nextStream = new MediaStream([nextTrack, ...audioTracks]);
    if (!pipeline.usingCanvas) await pipeline.localVideoTrack?.replaceTrack(nextTrack);
    pipeline.sourceStream = nextStream;
    pipeline.sourceVideo.srcObject = nextStream;
    await pipeline.sourceVideo.play().catch(() => {});
    oldTrack?.stop();
    if (pipeline.usingCanvas) {
      // The canvas renderer reads from sourceVideo; keep the canvas track
      // published while its source camera changes underneath it.
      pipeline.lastVideoTime = -1;
    }
    if (pipeline.localVideoTrack && !callElements(role).section.hidden) {
      attachCallTrack(role, pipeline.localVideoTrack, {
        identity: role === 'admin' ? 'anh' : 'vy',
        name: role === 'admin' ? 'Anh' : 'Vy'
      });
    }
    pipeline.facingMode = next;
    const tile = callElements(role).videos.querySelector('.call-tile.is-local-preview');
    tile?.classList.toggle('is-selfie-preview', next === 'user');
    setCallStatus(role, next === 'user' ? 'Đã chuyển sang camera trước.' : 'Đã chuyển sang camera sau.');
  } catch (error) {
    setCallStatus(role, 'Không chuyển được camera, camera hiện tại vẫn đang hoạt động.');
    console.warn('Không đổi được camera:', error.message);
  } finally {
    pipeline.switchingCamera = false;
  }
}

async function toggleCallScreenShare(role) {
  if (!livekitRoom || activeCallRole !== role || activeCallType === 'voice') return;
  const elements = callElements(role);
  const publication = livekitRoom.localParticipant.getTrackPublication(liveKitSDK?.Track.Source.ScreenShare);
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
    const response = await fetch(`/api/chat/messages?role=${role}`, { headers: sessionHeaders(role) });
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
  try {
    const response = await fetch('/api/chat/messages', {
      method: 'POST',
      headers: sessionHeaders(role, { 'Content-Type': 'application/json' }),
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
  try {
    await fetch('/api/chat/messages', {
      method: 'POST',
      headers: sessionHeaders(role, { 'Content-Type': 'application/json' }),
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
  if (state.authenticatedRole !== role) return;
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
  if (targetUrl.searchParams.get('admin') === '1' && state.authenticatedRole === 'admin' && $('#adminScreen').hidden) {
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
      if (role !== state.authenticatedRole) return;
      if (role === 'admin' && $('#adminScreen').hidden) showAdminScreen();
      showIncomingCall(role, event.data.callType === 'voice' ? 'voice' : 'video');
    }
  });
}

async function restoreAuthenticatedSession() {
  const adminToken = sessionToken('admin');
  if (adminToken) {
    try {
      const response = await fetch('/api/session', { headers: sessionHeaders('admin'), cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.role === 'admin') {
        state.authenticatedRole = 'admin';
        showAdminScreen();
        handleIncomingCallHint();
        handleIncomingNotificationTarget();
        return;
      }
    } catch { /* Keep the login screen visible while the server is unavailable. */ }
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    state.authenticatedRole = null;
  }
  const vyToken = sessionToken('vy');
  if (!vyToken) return;
  try {
    const response = await fetch('/api/session', { headers: sessionHeaders('vy'), cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.role !== 'vy') throw new Error('Phiên đăng nhập đã hết hạn.');
    state.authenticatedRole = 'vy';
    setAuthenticated(true);
    await loadSharedSchedule();
    handleIncomingCallHint();
    handleIncomingNotificationTarget();
  } catch {
    localStorage.removeItem(VY_TOKEN_KEY);
    state.authenticatedRole = null;
    setAuthenticated(false);
  }
}

function showAdminScreen() {
  if (state.authenticatedRole !== 'admin') return;
  closeKaraokeLyrics();
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
  closeKaraokeLyrics();
  stopChatPolling();
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  state.authenticatedRole = null;
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
    if (data.role !== 'admin' || typeof data.token !== 'string') throw new Error('Máy chủ không trả về phiên quản trị hợp lệ.');
    localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
    state.authenticatedRole = 'admin';
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
    const response = await fetch('/api/food-requests', { headers: sessionHeaders('admin') });
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
  const status = $('#scheduleSyncStatus');
  const retry = $('#retryScheduleLoad');
  let serverFallback = null;
  if (status) status.textContent = 'Đang tải lịch từ máy chủ…';
  if (retry) retry.hidden = true;
  try {
    const response = await fetch('/api/schedule', { headers: sessionHeaders('vy'), cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      localStorage.removeItem(VY_TOKEN_KEY);
      setAuthenticated(false);
      throw new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');
    }
    if (data.fallback === true && data.schedule && typeof data.schedule === 'object') serverFallback = data;
    if (!response.ok) throw new Error(data.error || 'Chưa tải được lịch dùng chung.');
    state.schedule = { ...(data.schedule || {}) };
    state.scheduleLoaded = true;
    renderOverview();
    renderCalendar();
    if (status) status.textContent = data.hasStoredEntries ? '' : data.storageMode === 'memory'
      ? 'Chưa có lịch lưu bền vững; lịch mới sẽ mất khi máy chủ khởi động lại.'
      : 'Đang hiển thị lịch mẫu; lịch này chưa được lưu trong cơ sở dữ liệu.';
  } catch (error) {
    state.schedule = serverFallback ? { ...serverFallback.schedule } : {};
    state.scheduleLoaded = false;
    renderOverview();
    renderCalendar();
    if (status) status.textContent = serverFallback
      ? `Không tải được lịch mới nhất: ${error.message} Đang hiển thị lịch dự phòng đến hết 25/10/2026; hãy thử tải lại để kiểm tra máy chủ.`
      : `Không tải được lịch: ${error.message}`;
    if (retry) retry.hidden = false;
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
  const schedule = state.adminSchedule || {};
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
    cell.innerHTML = `${key === todayKey ? '<span class="today-label">Hôm nay</span>' : ''}<span class="day-number">${day}</span>${code ? `<span class="shift-chip ${info.className}">${escapeHtml(code)}</span>` : '<span class="day-unassigned">Chưa cập nhật</span>'}`;
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
    const response = await fetch('/api/schedule?role=admin', { headers: sessionHeaders('admin'), cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      handleAdminSessionExpired();
      return;
    }
    if (!response.ok) throw new Error(data.error || 'Chưa tải được lịch của Vy.');
    state.adminSchedule = { ...(data.schedule || {}) };
    renderAdminCalendar();
    if (status) status.textContent = data.updatedAt ? `Cập nhật lần cuối ${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.updatedAt))}` : 'Chưa có lịch được lưu trên máy chủ.';
  } catch (error) {
    state.adminSchedule = {};
    renderAdminCalendar();
    if (status) status.textContent = error.message;
  }
}

async function updateFoodRequest(id, status) {
  await fetch(`/api/food-requests/${id}`, {
    method: 'PATCH',
    headers: sessionHeaders('admin', { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ status })
  });
  loadFoodRequests();
}

async function sendFoodResponse(id, responseText, status = 'pending') {
  if (!responseText) {
    showToast('Anh hãy ghi lời nhắn cho Vy trước nha 💕');
    return;
  }
  try {
    const response = await fetch(`/api/food-requests/${id}/respond`, {
      method: 'POST',
      headers: sessionHeaders('admin', { 'Content-Type': 'application/json' }),
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
  if (code === 'eAD') return { title: 'Lịch điều chỉnh', subtitle: 'Kiểm tra lại với điều dưỡng trưởng', className: 'adjusted', note: '💌 Nhớ kiểm tra lại lịch chi tiết nha!' };
  return { title: 'Chưa cập nhật', subtitle: 'Chưa có dữ liệu cho ngày này', className: 'unassigned', note: '💌 Lịch ngày này chưa được cập nhật.' };
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
  const todayCode = state.schedule[localDateKey(today)] || '';
  const tomorrowCode = state.schedule[localDateKey(tomorrow)] || '';
  renderShiftCard('today', today, todayCode);
  renderShiftCard('tomorrow', tomorrow, tomorrowCode);

  const hour = new Date().getHours();
  const greeting = hour < 11 ? 'Chào buổi sáng, Vy yêu 🌤️' : hour < 18 ? 'Chào buổi chiều, Vy yêu 🌼' : 'Chào buổi tối, Vy yêu 🌙';
  $('#welcomeTitle').textContent = greeting;
  $('#currentGreeting').textContent = 'Phan Thị Thảo Vy · số 6';
  $('#heroMessage').textContent = !todayCode ? 'Lịch hôm nay chưa được cập nhật; mình kiểm tra lại sau nhé.' : todayCode === 'D' || todayCode === 'N' ? 'Nàng nhớ giữ sức, làm việc vui vẻ và tan ca bình an để về với anh iu nhé.' : 'Hôm nay nàng có thể thong thả một chút, nhớ chăm sóc bản thân và nhớ anh iu nha.';
}

function renderShiftCard(prefix, date, code) {
  const info = codeInfo(code);
  $(`#${prefix}DateLabel`).textContent = displayDate(date, { day: 'numeric', month: 'short' });
  $(`#${prefix}Code`).textContent = code || '—';
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
    cell.innerHTML = `${key === todayKey ? '<span class="today-label">Hôm nay</span>' : ''}<span class="day-number">${day}</span>${code ? `<span class="shift-chip ${info.className}">${code}</span>` : '<span class="day-unassigned">Chưa cập nhật</span>'}`;
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
  state.selectedCode = state.schedule[key] || null;
  $('#modalDate').textContent = displayDate(parseDate(key), { weekday: 'long', day: 'numeric', month: 'long' });
  $('#modalTitle').textContent = `Lịch ngày ${parseDate(key).getDate()}${state.selectedCode ? '' : ' · Chưa cập nhật'}`;
  $('#modalSubtitle').textContent = state.selectedCode ? 'Chọn ca của Vy cho ngày này' : 'Ngày chưa có dữ liệu. Chỉ chọn ca khi lịch đã được xác nhận.';
  $('#saveShift').disabled = !state.selectedCode;
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
  if (!authenticated && state.authenticatedRole === 'vy') state.authenticatedRole = null;
  if (authenticated) startChatPolling('vy');
  else stopChatPolling();
}

async function handleLogin(event) {
  event.preventDefault();
  const username = $('#username').value.trim();
  const password = $('#password').value;
  const error = $('#loginError');
  try {
    const response = await fetch('/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      cache: 'no-store'
    });
    const session = await response.json().catch(() => ({}));
    if (!response.ok || typeof session.token !== 'string' || session.role !== 'vy') throw new Error(session.error || 'Tài khoản hoặc mật khẩu chưa đúng.');
    localStorage.setItem(VY_TOKEN_KEY, session.token);
    state.authenticatedRole = 'vy';
    error.textContent = '';
    setAuthenticated(true);
    renderOverview();
    renderCalendar();
    await loadSharedSchedule();
    handleIncomingNotificationTarget();
    showToast('Đăng nhập thành công, chào Vy yêu 💗');
  } catch (loginError) {
    localStorage.removeItem(VY_TOKEN_KEY);
    error.textContent = loginError.message || 'Không thể kết nối máy chủ đăng nhập.';
    $('#password').select();
  }
}

function handleLogout() {
  closeKaraokeLyrics();
  localStorage.removeItem(VY_TOKEN_KEY);
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  state.authenticatedRole = null;
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
  const token = role === 'admin' ? adminToken : sessionToken('vy');
  if (token) headers.Authorization = `Bearer ${token}`;
  const subscribeResponse = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers,
    body: JSON.stringify({ subscription, role })
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
    $('#saveShift').disabled = false;
    $$('#shiftPicker button').forEach((item) => item.classList.toggle('active', item === button));
  }));
  $('#saveShift').addEventListener('click', async () => {
    if (!state.selectedDate || !state.selectedCode) return;
    const previousSchedule = { ...state.schedule };
    state.schedule[state.selectedDate] = state.selectedCode;
    $('#saveShift').disabled = true;
    try {
      await syncScheduleToServer(state.schedule);
    } catch (error) {
      state.schedule = previousSchedule;
      renderOverview();
      renderCalendar();
      showToast(error.message || 'Chưa lưu được lịch.');
      $('#saveShift').disabled = false;
      return;
    }
    renderOverview();
    closeDayModal();
    showToast('Đã lưu lịch mới cho Vy rồi nha 🌷');
  });
  $('#retryScheduleLoad').addEventListener('click', () => loadSharedSchedule());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#dayModal').hidden) closeDayModal();
  });
}

function init() {
  applyAvatarImage();
  renderFoodMenu();
  bindKaraoke();
  bindEvents();
  bindNotificationNavigation();
  setAuthenticated(false);
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
  restoreAuthenticatedSession();
}

init();
