import { defaultSchedule } from './schedule-data.js';
import { AVATAR_IMAGE_URL } from './avatar-config.js';
import { Room, RoomEvent, Track, VideoPresets } from 'livekit-client';

const STORAGE_KEY = 'lich-cua-vy-schedule-v2';
const AUTH_KEY = 'lich-cua-vy-authenticated-v1';
const ADMIN_TOKEN_KEY = 'lich-cua-vy-admin-token-v1';
const ADMIN_PUSH_ENABLED_KEY = 'lich-cua-vy-admin-push-enabled-v1';
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
  visibleMonth: new Date(2026, 9, 1),
  selectedDate: null,
  selectedCode: null,
  selectedFood: null,
  selectedFoodCategory: null,
  toastTimer: null,
  countdownTimer: null,
  chatTimer: null,
  chatLoading: false
};

let nativeNotificationsPromise;
let livekitRoom;
let activeCallRole;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
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
    state.selectedFood = button.dataset.food;
    state.selectedFoodCategory = button.dataset.category;
    $$('.food-option').forEach((item) => item.classList.toggle('selected', item === button));
    $('#foodRequestStatus').textContent = `Em đang chọn: ${state.selectedFood} 💗`;
  }));
}

async function submitFoodRequest() {
  const note = $('#foodNote').value.trim();
  if (!state.selectedFood && !note) {
    $('#foodRequestStatus').textContent = 'Em chọn một món hoặc ghi chú món em thích trước nha 💕';
    return;
  }
  const button = $('#sendFoodRequest');
  button.disabled = true;
  try {
    const response = await fetch('/api/food-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: state.selectedFoodCategory || 'Món em ghi chú',
        item: state.selectedFood || 'Món theo ghi chú',
        note
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Chưa gửi được request món ăn.');
    $('#foodRequestStatus').textContent = 'Anh nhận được rồi nha, để anh đi mua cho em 💌';
    $('#foodNote').value = '';
    state.selectedFood = null;
    state.selectedFoodCategory = null;
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
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function renderChatMessages(messages, selector, viewerRole) {
  const container = $(selector);
  if (!container) return;
  const shouldStickToBottom = !container.dataset.ready || container.scrollHeight - container.scrollTop - container.clientHeight < 90;
  container.innerHTML = messages.length ? messages.map((message) => {
    const own = message.sender_role === viewerRole;
    const sender = own ? (viewerRole === 'admin' ? 'Anh' : 'Vy') : (viewerRole === 'admin' ? 'Vy' : 'Anh');
    const content = escapeHtml(message.content).replace(/\r?\n/g, '<br />');
    return `<article class="chat-message ${own ? 'is-mine' : 'is-theirs'}">
      <div class="chat-bubble"><p>${content}</p><time datetime="${escapeHtml(message.created_at)}">${sender} · ${chatTime(message.created_at)}</time></div>
    </article>`;
  }).join('') : '<p class="chat-empty">Chưa có tin nhắn nào. Nhắn một câu thật ngọt cho người thương nha 💗</p>';
  container.dataset.ready = 'true';
  if (shouldStickToBottom) container.scrollTop = container.scrollHeight;
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
  const button = senderRole === 'admin' ? $('#sendAdminChat') : $('#sendChat');
  const status = senderRole === 'admin' ? $('#adminChatStatus') : $('#chatStatus');
  const content = input.value.trim();
  if (!content) {
    status.textContent = 'Viết một điều muốn nói trước nha 💗';
    input.focus();
    return;
  }
  const token = senderRole === 'admin' ? localStorage.getItem(ADMIN_TOKEN_KEY) : '';
  button.disabled = true;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch('/api/chat/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({ senderRole, content })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Chưa gửi được tin nhắn.');
    input.value = '';
    status.textContent = senderRole === 'admin' ? 'Đã gửi cho Vy 💌' : 'Đã gửi cho anh 💌';
    await loadChatMessages(senderRole);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    input.focus();
  }
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
    stage: $(admin ? '#adminCallStage' : '#callStage'),
    videos: $(admin ? '#adminCallVideos' : '#callVideos'),
    status: $(admin ? '#adminCallStatus' : '#callStatus'),
    start: $(admin ? '#startAdminVideoCall' : '#startVideoCall'),
    join: $(admin ? '#joinAdminVideoCall' : '#joinVideoCall'),
    camera: $(admin ? '#toggleAdminCamera' : '#toggleCamera'),
    microphone: $(admin ? '#toggleAdminMicrophone' : '#toggleMicrophone'),
    end: $(admin ? '#endAdminCall' : '#endCall')
  };
}

function setCallStatus(role, message) {
  const elements = callElements(role);
  if (elements.status) elements.status.textContent = message;
}

function setCallControls(role, connected) {
  const elements = callElements(role);
  if (!elements.stage) return;
  elements.stage.hidden = !connected;
  elements.start.disabled = connected;
  elements.join.disabled = connected;
  elements.camera.disabled = !connected;
  elements.microphone.disabled = !connected;
  elements.end.disabled = !connected;
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
  setCallStatus(role, remoteCount ? 'Đã kết nối với người thương 💗' : 'Đang chờ người kia tham gia phòng…');
}

async function joinLiveKitCall(role = 'vy', announce = false) {
  const elements = callElements(role);
  if (!elements.status) return;
  if (livekitRoom) await leaveLiveKitCall();
  elements.start.disabled = true;
  elements.join.disabled = true;
  setCallStatus(role, 'Đang mở phòng video…');
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
      body: JSON.stringify({ role, announce })
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
      updateCallStatus(role);
    });
    room.on(RoomEvent.ParticipantConnected, () => updateCallStatus(role));
    room.on(RoomEvent.Disconnected, () => {
      if (livekitRoom !== room) return;
      livekitRoom = null;
      activeCallRole = null;
      setCallControls(role, false);
      setCallStatus(role, 'Cuộc gọi đã kết thúc.');
    });

    await room.connect(tokenData.serverUrl, tokenData.participantToken);
    await room.localParticipant.enableCameraAndMicrophone();
    const localCamera = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    if (localCamera) attachCallTrack(role, localCamera, room.localParticipant);
    room.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((publication) => {
        if (publication.track) attachCallTrack(role, publication.track, participant);
      });
    });
    setCallControls(role, true);
    updateCallStatus(role);
  } catch (error) {
    if (livekitRoom) {
      await livekitRoom.disconnect().catch(() => {});
      livekitRoom = null;
      activeCallRole = null;
    }
    setCallControls(role, false);
    setCallStatus(role, error.message || 'Chưa mở được phòng video.');
  }
}

async function leaveLiveKitCall() {
  const role = activeCallRole;
  if (livekitRoom) await livekitRoom.disconnect();
  livekitRoom = null;
  activeCallRole = null;
  if (role) {
    const elements = callElements(role);
    elements.videos.innerHTML = '';
    setCallControls(role, false);
    setCallStatus(role, 'Đã rời cuộc gọi.');
  }
}

async function toggleCallCamera(role) {
  if (!livekitRoom || activeCallRole !== role) return;
  const enabled = !livekitRoom.localParticipant.isCameraEnabled;
  await livekitRoom.localParticipant.setCameraEnabled(enabled);
  callElements(role).camera.textContent = enabled ? 'Tắt camera' : 'Bật camera';
}

async function toggleCallMicrophone(role) {
  if (!livekitRoom || activeCallRole !== role) return;
  const enabled = !livekitRoom.localParticipant.isMicrophoneEnabled;
  await livekitRoom.localParticipant.setMicrophoneEnabled(enabled);
  callElements(role).microphone.textContent = enabled ? 'Tắt mic' : 'Bật mic';
}

function handleIncomingCallHint() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('call') !== '1') return;
  const role = params.get('admin') === '1' ? 'admin' : 'vy';
  const elements = callElements(role);
  elements.section?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  showToast('Có người thương đang gọi video 💗 Bấm “Tham gia video” nha.');
  window.history.replaceState({}, document.title, window.location.pathname);
}

function showAdminScreen() {
  $('#loginScreen').hidden = true;
  $('#appShell').classList.remove('is-unlocked');
  $('#appShell').hidden = true;
  $('#adminScreen').hidden = false;
  updateAdminNotificationUi();
  startChatPolling('admin');
  loadFoodRequests();
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
  nativeNotificationsPromise ||= import('@capacitor/local-notifications').then((module) => module.LocalNotifications).catch(() => null);
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
  $('#sendFoodRequest').addEventListener('click', submitFoodRequest);
  $('#chatForm').addEventListener('submit', (event) => {
    event.preventDefault();
    sendChatMessage('vy');
  });
  $('#adminChatForm').addEventListener('submit', (event) => {
    event.preventDefault();
    sendChatMessage('admin');
  });
  bindChatQuickReplies();
  $('#startVideoCall').addEventListener('click', () => joinLiveKitCall('vy', true));
  $('#joinVideoCall').addEventListener('click', () => joinLiveKitCall('vy', false));
  $('#toggleCamera').addEventListener('click', () => toggleCallCamera('vy'));
  $('#toggleMicrophone').addEventListener('click', () => toggleCallMicrophone('vy'));
  $('#endCall').addEventListener('click', leaveLiveKitCall);
  $('#startAdminVideoCall').addEventListener('click', () => joinLiveKitCall('admin', true));
  $('#joinAdminVideoCall').addEventListener('click', () => joinLiveKitCall('admin', false));
  $('#toggleAdminCamera').addEventListener('click', () => toggleCallCamera('admin'));
  $('#toggleAdminMicrophone').addEventListener('click', () => toggleCallMicrophone('admin'));
  $('#endAdminCall').addEventListener('click', leaveLiveKitCall);
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
  renderFoodMenu();
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
  if (localStorage.getItem(ADMIN_TOKEN_KEY)) showAdminScreen();
  handleIncomingCallHint();
}

init();
