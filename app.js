import { defaultSchedule } from './schedule-data.js';
import { AVATAR_IMAGE_URL } from './avatar-config.js';

const STORAGE_KEY = 'lich-cua-vy-schedule-v2';
const AUTH_KEY = 'lich-cua-vy-authenticated-v1';
const DEMO_USERNAME = 'phanthithaovy';
const DEMO_PASSWORD = '261004';
const START_DATE = '2026-09-26';
const END_DATE = '2026-10-25';

const state = {
  schedule: loadSchedule(),
  visibleMonth: new Date(2026, 9, 1),
  selectedDate: null,
  selectedCode: null,
  toastTimer: null,
  countdownTimer: null
};

let nativeNotificationsPromise;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

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
  if (code === 'D') return { title: 'Ca ngày · 12 tiếng', subtitle: '07:30 — 19:30', className: 'day', note: '☀️ Chúc nàng một ca ngày thật suôn sẻ nha!' };
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
    end.setHours(19, 30, 0, 0);
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
  $('#currentGreeting').textContent = 'Phan Thị Thảo Vy · số 8';
  $('#heroMessage').textContent = todayCode === 'D' || todayCode === 'N' ? 'Nàng nhớ giữ sức, làm việc thật chuyên nghiệp và tan ca bình an nhé.' : 'Hôm nay nàng có thể thong thả một chút, nhớ chăm sóc bản thân nha.';
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
    cell.innerHTML = `<span class="day-number">${day}</span>${code ? `<span class="shift-chip ${info.className}">${code}</span>` : ''}`;
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

function openDayModal(key) {
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
  } else {
    localStorage.removeItem(AUTH_KEY);
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
  if (code === 'D') return 'đi làm ca D · 07:30–19:30';
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
    events.push(createCalendarEvent(`${key}-today`, todayStart, `Lịch hôm nay: ${description}`, `Vy ơi, hôm nay ${description}. Cố lên và nhớ giữ sức nhé 💗`));

    const tomorrow = new Date(date);
    tomorrow.setDate(tomorrow.getDate() - 1);
    const tomorrowCode = state.schedule[localDateKey(date)];
    const tomorrowStart = new Date(tomorrow);
    tomorrowStart.setHours(17, 0, 0, 0);
    events.push(createCalendarEvent(`${key}-tomorrow`, tomorrowStart, `Lịch ngày mai: ${description}`, `Vy ơi, ngày mai ${description}. Chuẩn bị nhẹ nhàng để ngày mai thật vui nha 💗`));
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
  link.download = 'lich-cua-vy-nhac-06h-17h.ics';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast('Đã tạo lịch nhắc 06:00 và 17:00. Hãy mở file bằng ứng dụng Lịch nhé 📅');
}

async function enableNotifications() {
  const nativeNotifications = await getNativeNotifications();
  if (nativeNotifications) {
    await scheduleNativeReminders(nativeNotifications);
    $('#notificationIcon').textContent = '♥';
    $('#reminderTitle').textContent = 'Nhắc lịch điện thoại đã bật';
    $('#reminderDescription').textContent = 'Vy sẽ được nhắc lúc 06:00 và 17:00 kể cả khi app đã đóng.';
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
    showToast('Đã bật nhắc 06:00 và 17:00 cho Vy rồi 💗');
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

async function subscribeToWebPush() {
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
  const subscribeResponse = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription)
  });
  if (!subscribeResponse.ok) throw new Error('Không lưu được thiết bị nhận nhắc. Vy thử lại nhé.');
}

async function getNativeNotifications() {
  if (!window.Capacitor) return null;
  nativeNotificationsPromise ||= import('@capacitor/local-notifications').then((module) => module.LocalNotifications).catch(() => null);
  return nativeNotificationsPromise;
}

function nativeReminderBody(label, date) {
  const dateText = displayDate(date, { weekday: 'long', day: 'numeric', month: 'numeric' });
  return `Vy ơi, ${dateText}: ${label}. Cố lên và nhớ giữ sức nhé 💗`;
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
    const todayAtSix = new Date(date);
    todayAtSix.setHours(6, 0, 0, 0);
    if (todayAtSix > now) {
      notifications.push({
        id: 600000 + index,
        title: 'Lịch hôm nay của Vy 🌷',
        body: nativeReminderBody(label, date),
        schedule: { at: todayAtSix },
        smallIcon: 'ic_stat_icon_config_sample'
      });
    }
    const tomorrowAtFive = new Date(date);
    tomorrowAtFive.setDate(tomorrowAtFive.getDate() - 1);
    tomorrowAtFive.setHours(17, 0, 0, 0);
    if (tomorrowAtFive > now) {
      notifications.push({
        id: 170000 + index,
        title: 'Lịch ngày mai của Vy 💌',
        body: nativeReminderBody(label, date),
        schedule: { at: tomorrowAtFive },
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
  $('#reminderDescription').textContent = enabled ? 'Vy sẽ được nhắc lúc 06:00 và 17:00, kể cả khi đã đóng app.' : 'Bật thông báo để Vy không bỏ lỡ ca làm nhé.';
  $('#enableNotification').textContent = enabled ? 'Đã bật' : 'Bật nhắc';
}

function bindEvents() {
  $('#loginForm').addEventListener('submit', handleLogin);
  $('#logoutButton').addEventListener('click', handleLogout);
  $('#enableNotification').addEventListener('click', enableNotifications);
  $('#exportCalendar').addEventListener('click', exportCalendarFile);
  $('#notificationButton').addEventListener('click', enableNotifications);
  $('#previousMonth').addEventListener('click', () => {
    state.visibleMonth = new Date(state.visibleMonth.getFullYear(), state.visibleMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  $('#nextMonth').addEventListener('click', () => {
    state.visibleMonth = new Date(state.visibleMonth.getFullYear(), state.visibleMonth.getMonth() + 1, 1);
    renderCalendar();
  });
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
  bindEvents();
  setAuthenticated(localStorage.getItem(AUTH_KEY) === 'true');
  renderOverview();
  renderCalendar();
  updateNotificationUi();
  renderLiveCountdown();
  state.countdownTimer = setInterval(renderLiveCountdown, 30000);
  $('#lastUpdated').textContent = `Cập nhật ${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date())}`;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
      console.error('Không đăng ký được service worker:', error);
    });
  }
}

init();
