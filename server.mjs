import express from 'express';
import cron from 'node-cron';
import pg from 'pg';
import webpush from 'web-push';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { basename, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { AccessToken, LiveKitAPI } from 'livekit-server-sdk';
import { defaultSchedule, getScheduleCode } from './schedule-data.js';
import { AVATAR_IMAGE_URL } from './avatar-config.js';
import { UNIQUE_KARAOKE_SONGS } from './karaoke-data.js';
import { parseSyncedKaraokeLyrics, syncedLyricsMatchReference } from './karaoke-timing.js';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 4173);
const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);
const distRoot = resolve(fileURLToPath(new URL('./dist', import.meta.url)));
const projectRoot = resolve(fileURLToPath(new URL('./', import.meta.url)));
const publicRoot = resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const audioManifestPath = resolve(fileURLToPath(new URL('./public/audio-manifest.json', import.meta.url)));
const localAudioOverridesPath = resolve(fileURLToPath(new URL('./reports/karaoke-local-audio-overrides.json', import.meta.url)));
const karaokeLrcManifestPath = resolve(fileURLToPath(new URL('./public/karaoke-lrc-manifest.json', import.meta.url)));
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, query_timeout: 12000, statement_timeout: 10000, max: 8 }) : null;
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
const lyricsProvider = (process.env.LYRICS_PROVIDER || 'lrclib').trim().toLowerCase();
const musixmatchApiKey = process.env.MUSIXMATCH_API_KEY?.trim();
const lrclibBaseUrl = (process.env.LRCLIB_BASE_URL || 'https://lrclib.net').trim().replace(/\/$/, '');
const lrclibUserAgent = process.env.LRCLIB_USER_AGENT?.trim()
  || 'LichCuaVy-Karaoke/1.0 (https://github.com/taitottinhday/lichptv)';
const lyricsPersistenceAllowed = process.env.LYRICS_PERSISTENCE_ALLOWED === 'true';
const lrclibCacheAllowed = process.env.LRCLIB_CACHE_ALLOWED === 'true';
const lyricsCacheAllowed = lyricsPersistenceAllowed && (lyricsProvider !== 'lrclib' || lrclibCacheAllowed);
const lyricsPublicLookupEnabled = process.env.LYRICS_PUBLIC_LOOKUP_ENABLED !== 'false';
const lyricsProviderConfigured = lyricsProvider === 'link' || lyricsProvider === 'lrclib'
  || (lyricsProvider === 'musixmatch' && Boolean(musixmatchApiKey));
const adminUsername = process.env.ADMIN_USERNAME?.trim() || '';
const adminPassword = process.env.ADMIN_PASSWORD || '';
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || (isProduction ? '' : randomBytes(32).toString('base64url'));
const vyUsername = process.env.VY_USERNAME?.trim() || '';
const vyPassword = process.env.VY_PASSWORD || '';
const credentialConfigError = [
  !adminUsername && 'ADMIN_USERNAME', (!adminPassword || adminPassword.length < 12) && 'ADMIN_PASSWORD (ít nhất 12 ký tự)',
  !vyUsername && 'VY_USERNAME', (!vyPassword || vyPassword.length < 12) && 'VY_PASSWORD (ít nhất 12 ký tự)',
  (!adminSessionSecret || Buffer.byteLength(adminSessionSecret) < 32) && 'ADMIN_SESSION_SECRET (ít nhất 32 byte)'
].filter(Boolean);
if (credentialConfigError.length && isProduction) {
  throw new Error(`Thiếu cấu hình xác thực production: ${credentialConfigError.join(', ')}.`);
}
if (isProduction && !databaseUrl) {
  throw new Error('Thiếu cấu hình production: DATABASE_URL bắt buộc để tránh mất lịch, chat và request sau khi dịch vụ khởi động lại.');
}
const r2AccountId = process.env.R2_ACCOUNT_ID?.trim();
const r2BucketName = process.env.R2_BUCKET_NAME?.trim();
const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const r2UrlTtlSeconds = Math.min(604800, Math.max(60, Number(process.env.R2_URL_TTL_SECONDS || 900)));
const r2Configured = Boolean(r2AccountId && r2BucketName && r2AccessKeyId && r2SecretAccessKey);
const adminSessionTtlMs = 30 * 24 * 60 * 60 * 1000;
const memoryFoodRequests = [];
let memoryFoodRequestId = 0;
const memoryChatMessages = [];
let memoryChatMessageId = 0;
const memoryChatReactions = new Map();
const memoryLyrics = new Map();
const karaokeMetadataCache = new Map();
const zingLrcCache = new Map();
let zingLrcManifestPromise;
const memorySchedule = {};
let memoryScheduleUpdatedAt = null;
let pushConfigured = false;
const CHAT_IMAGE_PREFIX = '__lich_chat_image__:';
const CHAT_STORAGE_BUCKET = 'chat-images';
const CHAT_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
let chatStorageReadyPromise;
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

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
    );
    CREATE TABLE IF NOT EXISTS chat_message_reactions (
      message_id BIGINT REFERENCES chat_messages(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('vy', 'admin')),
      reaction TEXT NOT NULL CHECK (reaction IN ('💗', '😂', '😮', '✨', '🥰')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, role)
    );
    CREATE TABLE IF NOT EXISTS schedule_entries (
      date_key TEXT PRIMARY KEY,
      code TEXT NOT NULL CHECK (code IN ('D', 'N', '18', '9', 'eAD')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS lyrics_entries (
      song_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL DEFAULT '',
      lyrics_text TEXT NOT NULL,
      synced_lyrics_text TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      provider_track_id TEXT,
      album_name TEXT NOT NULL DEFAULT '',
      duration_seconds NUMERIC,
      has_word_sync BOOLEAN NOT NULL DEFAULT FALSE,
      match_score NUMERIC NOT NULL DEFAULT 0,
      verification_status TEXT NOT NULL DEFAULT 'verified',
      cache_allowed BOOLEAN NOT NULL DEFAULT FALSE,
      attribution TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE lyrics_entries ADD COLUMN IF NOT EXISTS synced_lyrics_text TEXT NOT NULL DEFAULT '';
    ALTER TABLE lyrics_entries ADD COLUMN IF NOT EXISTS album_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE lyrics_entries ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC;
    ALTER TABLE lyrics_entries ADD COLUMN IF NOT EXISTS has_word_sync BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE TABLE IF NOT EXISTS song_lyrics (
      song_id TEXT PRIMARY KEY,
      lyrics TEXT NOT NULL,
      synced_lyrics TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      source_track_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO song_lyrics (song_id, lyrics, synced_lyrics, source, source_track_id, created_at, updated_at)
    SELECT song_id, lyrics_text, synced_lyrics_text, source, provider_track_id, updated_at, updated_at
    FROM lyrics_entries
    WHERE cache_allowed = TRUE
    ON CONFLICT (song_id) DO NOTHING;
    UPDATE song_lyrics SET synced_lyrics = '' WHERE synced_lyrics <> '';
    UPDATE lyrics_entries
    SET synced_lyrics_text = '', has_word_sync = FALSE
    WHERE synced_lyrics_text <> '' OR has_word_sync = TRUE;`)
  : Promise.resolve();

// Observe schema startup failures so the process stays alive long enough for
// API handlers to return a clear error instead of exiting on an unhandled promise.
if (pool) databaseReady.catch((error) => {
  console.error('PostgreSQL schema initialization failed:', error.code || error.name || 'unknown database error');
});

async function supabaseRequest(path, options = {}) {
  if (!supabaseConfigured) throw new Error('Supabase chưa được cấu hình.');
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(8000),
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

function normalizeMusicText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeTrackTitle(value) {
  const title = String(value || '');
  const normalize = (text) => text.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLocaleLowerCase('vi-VN')
    .match(/[\p{L}\p{N}]+/gu)?.join(' ') || '';
  const normalized = normalize(title);
  const withoutTrailingQualifier = normalize(title.replace(/\s*[([{][^()[\]{}]*[)\]}]\s*$/g, ''));
  return withoutTrailingQualifier || normalized;
}

const lrclibTitleQualifiers = new Set([
  'original', 'official', 'audio', 'video', 'mv', 'music', 'lyrics', 'lyric', 'live', 'version',
  'ver', 'acoustic', 'remix', 'cover', 'karaoke', 'remastered', 'from', 'ost', 'full', 'hd', '4k'
]);

function lrclibTitleMatches(candidate, titleKey) {
  const candidateKey = normalizeTrackTitle(candidate);
  if (candidateKey === titleKey) return true;
  if (!candidateKey.startsWith(`${titleKey} `)) return false;
  return candidateKey.slice(titleKey.length + 1).split(' ').every((token) =>
    lrclibTitleQualifiers.has(token) || /^\d{4}$/.test(token));
}

function karaokeSongById(songId) {
  return UNIQUE_KARAOKE_SONGS.find((song) => song.songId === String(songId || '').trim());
}

async function karaokeManifestMetadata(song) {
  try {
    const manifest = await readAudioManifestWithLocalOverrides();
    const entry = manifest.entries?.[song.songId];
    return {
      artist: String(entry?.artist || '').trim(),
      duration: Number(entry?.durationSeconds) || null
    };
  } catch {
    return { artist: '', duration: null };
  }
}

function lyricsAttribution(source) {
  if (source === 'musixmatch') return 'Lyrics data provided under the Musixmatch API terms.';
  if (source === 'lrclib') return 'Lyrics retrieved from LRCLIB; verify rights before redistribution.';
  if (source === 'zing-lrc') return 'Lyrics retrieved from Zing MP3.';
  return '';
}

function lyricsSourceForSong(song) {
  const artist = song.artist || song.composer || '';
  const query = [song.title, artist, 'lời bài hát'].filter(Boolean).join(' ');
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  return {
    provider: 'link',
    sourceName: 'Tìm nguồn lời bài hát hợp pháp',
    url,
    sourceUrl: url,
    query
  };
}

async function readStoredLyrics(songId) {
  if (pool) {
    await databaseReady;
    const result = await pool.query(
      `SELECT song_id,
              lyrics AS lyrics_text,
              synced_lyrics AS synced_lyrics_text,
              source,
              source_track_id AS provider_track_id,
              TRUE AS cache_allowed,
              updated_at
       FROM song_lyrics WHERE song_id = $1`,
      [songId]
    );
    return result.rows[0] || null;
  }
  return memoryLyrics.get(songId) || null;
}

function lyricsTextMatches(left, right) {
  return syncedLyricsMatchReference(left, right);
}

async function localLyricsText(songId) {
  try { return await readFile(resolve(publicRoot, 'lyrics', `${songId}.txt`), 'utf8'); } catch { return ''; }
}

async function writeStoredLyrics(entry) {
  if (!lyricsCacheAllowed || entry.cacheAllowed !== true) return null;
  if (pool) {
    await databaseReady;
    const result = await pool.query(
      `INSERT INTO song_lyrics
         (song_id, lyrics, synced_lyrics, source, source_track_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (song_id) DO UPDATE SET
         lyrics = EXCLUDED.lyrics,
         synced_lyrics = EXCLUDED.synced_lyrics,
         source = EXCLUDED.source,
         updated_at = NOW()
       RETURNING song_id,
                 lyrics AS lyrics_text,
                 synced_lyrics AS synced_lyrics_text,
                 source,
                 source_track_id AS provider_track_id,
                 TRUE AS cache_allowed,
                 updated_at`,
      [entry.songId, entry.lyrics, entry.syncedLyrics || '', entry.source, entry.providerTrackId || null]
    );
    return result.rows[0] || null;
  }
  const stored = {
    song_id: entry.songId,
    title: entry.title,
    artist: entry.artist || '',
    lyrics_text: entry.lyrics,
    synced_lyrics_text: entry.syncedLyrics || '',
    source: entry.source,
    provider_track_id: entry.providerTrackId || null,
    album_name: entry.albumName || '',
    duration_seconds: entry.durationSeconds || null,
    has_word_sync: entry.hasWordSync === true,
    match_score: entry.matchScore || 0,
    verification_status: entry.verificationStatus || 'verified',
    cache_allowed: entry.cacheAllowed === true,
    attribution: entry.attribution || '',
    updated_at: new Date().toISOString()
  };
  memoryLyrics.set(entry.songId, stored);
  return stored;
}

async function musixmatchRequest(path, params = {}) {
  if (!musixmatchApiKey) throw new Error('MUSIXMATCH_API_KEY chưa được cấu hình.');
  const url = new URL(`https://api.musixmatch.com/ws/v1.1/${path}`);
  url.search = new URLSearchParams({ apikey: musixmatchApiKey, ...params });
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error('Musixmatch trả về dữ liệu không hợp lệ.'); }
  if (!response.ok) throw new Error(`Musixmatch HTTP ${response.status}`);
  const statusCode = Number(data?.message?.header?.status_code || 0);
  if (statusCode !== 200) throw new Error(`Musixmatch status ${statusCode}`);
  return data?.message?.body || {};
}

function chooseMusixmatchTrack(song, tracks) {
  const titleKey = normalizeMusicText(song.title);
  const artistKey = normalizeMusicText(song.artist || song.composer);
  const exactTitle = tracks.filter((item) => normalizeMusicText(item.track?.track_name) === titleKey);
  if (!exactTitle.length) return { status: 'not_found', reason: 'Không có kết quả trùng chính xác tên bài.' };
  const artistMatches = artistKey
    ? exactTitle.filter((item) => normalizeMusicText(item.track?.artist_name) === artistKey)
    : exactTitle;
  if (artistKey && artistMatches.length !== 1) {
    return { status: 'needs_verification', reason: 'Có nhiều phiên bản hoặc không khớp ca sĩ.' };
  }
  if (!artistKey && exactTitle.length !== 1) {
    return { status: 'needs_verification', reason: 'Có nhiều bài trùng tên; cần bổ sung ca sĩ để xác nhận.' };
  }
  const selected = (artistMatches.length ? artistMatches : exactTitle)[0]?.track;
  if (!selected?.track_id) return { status: 'not_found', reason: 'Kết quả không có track_id.' };
  return {
    status: 'matched',
    track: selected,
    score: artistKey ? 1 : 0.9
  };
}

function cleanMusixmatchLyrics(value) {
  return String(value || '')
    .replace(/\s*\*{3,}\s*This Lyrics is NOT for Commercial use\s*\*{3,}\s*$/i, '')
    .trim();
}

function stripLrcTimestamps(value) {
  return String(value || '')
    .replace(/^\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s?/gm, '')
    .trim();
}

function parseRetryAfterMs(value) {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10000);
  const date = Date.parse(value || '');
  return Number.isFinite(date) ? Math.max(0, Math.min(date - Date.now(), 10000)) : 1000;
}

function waitForLyricsRetry(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lrclibRequest(path, params = {}) {
  const url = new URL(`${lrclibBaseUrl}${path}`);
  url.search = new URLSearchParams(params);
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': lrclibUserAgent,
          'X-User-Agent': lrclibUserAgent
        },
        signal: AbortSignal.timeout(15000)
      });
      if (response.ok) {
        const text = await response.text();
        try { return text ? JSON.parse(text) : null; } catch { throw new Error('LRCLIB trả về JSON không hợp lệ.'); }
      }
      if (response.status !== 503 && response.status !== 429) {
        if (response.status === 404) return null;
        throw new Error(`LRCLIB HTTP ${response.status}`);
      }
      const retryAfter = parseRetryAfterMs(response.headers.get('retry-after'));
      lastError = new Error(`LRCLIB HTTP ${response.status}`);
      if (attempt < 2) await waitForLyricsRetry(Math.max(retryAfter, 500 * (2 ** attempt)));
    } catch (error) {
      lastError = error;
      if (attempt < 2 && /fetch failed|timeout|503|429/i.test(error.message)) {
        await waitForLyricsRetry(500 * (2 ** attempt));
      } else if (attempt >= 2) {
        throw error;
      }
    }
  }
  throw lastError || new Error('LRCLIB không phản hồi.');
}

function chooseLrclibTrack(song, records) {
  const titleKey = normalizeTrackTitle(song.title);
  const artistKey = normalizeTrackTitle(song.artist || song.composer);
  const exactTitle = records.filter((record) => lrclibTitleMatches(record.trackName || record.name, titleKey));
  if (!exactTitle.length) return { status: 'not_found', reason: 'LRCLIB không có kết quả trùng chính xác tên bài.' };
  const artistMatches = artistKey
    ? exactTitle.filter((record) => normalizeTrackTitle(record.artistName) === artistKey)
    : exactTitle;
  if (artistKey && artistMatches.length === 0) {
    return { status: 'needs_verification', reason: 'Tên bài khớp nhưng ca sĩ không khớp.' };
  }
  const exactArtistSpelling = artistKey
    ? artistMatches.filter((record) => String(record.artistName || '').trim().toLocaleLowerCase('vi-VN')
      === String(song.artist || song.composer || '').trim().toLocaleLowerCase('vi-VN'))
    : exactTitle;
  const candidates = artistKey ? (exactArtistSpelling.length ? exactArtistSpelling : artistMatches) : exactTitle;
  const expectedDuration = Number(song.duration);
  const hasExpectedDuration = Number.isFinite(expectedDuration) && expectedDuration > 0;
  const durationTolerance = hasExpectedDuration ? Math.max(2, expectedDuration * 0.005) : 0;
  if (candidates.length > 1 && (!hasExpectedDuration || candidates.some((record) => !Number.isFinite(Number(record.duration))))) {
    return { status: 'needs_verification', reason: 'Có nhiều phiên bản cùng tên nhưng thiếu thời lượng để khớp audio.' };
  }
  const ranked = [...candidates].sort((left, right) => {
    const leftDistance = Number.isFinite(expectedDuration) && Number.isFinite(Number(left.duration))
      ? Math.abs(Number(left.duration) - expectedDuration) : 0;
    const rightDistance = Number.isFinite(expectedDuration) && Number.isFinite(Number(right.duration))
      ? Math.abs(Number(right.duration) - expectedDuration) : 0;
    return leftDistance - rightDistance;
  });
  const selected = ranked[0];
  if (hasExpectedDuration && Number.isFinite(Number(selected?.duration))) {
    const distance = Math.abs(Number(selected.duration) - expectedDuration);
    if (distance > durationTolerance) {
      return { status: 'needs_verification', reason: 'Thời lượng audio khác bản lời tìm thấy.' };
    }
    const secondDistance = ranked[1] && Number.isFinite(Number(ranked[1].duration))
      ? Math.abs(Number(ranked[1].duration) - expectedDuration) : Infinity;
    if (secondDistance - distance < 2) {
      return { status: 'needs_verification', reason: 'Có nhiều bản cùng tên với thời lượng gần nhau.' };
    }
  }
  if (!selected?.id) return { status: 'not_found', reason: 'Kết quả LRCLIB không có id.' };
  return { status: 'matched', track: selected, score: artistKey ? 1 : 0.9 };
}

async function resolveLrclibLyrics(song) {
  const manifest = await karaokeManifestMetadata(song);
  const artist = song.artist || song.composer || manifest.artist;
  const lookupSong = {
    ...song,
    ...(artist ? { artist } : {}),
    ...(Number(song.duration) > 0 ? {} : manifest.duration ? { duration: manifest.duration } : {})
  };
  const searchParams = {
    track_name: song.title,
    ...(lookupSong.artist || lookupSong.composer ? { artist_name: lookupSong.artist || lookupSong.composer } : {})
  };
  let records = await lrclibRequest('/api/search', searchParams);
  let match = chooseLrclibTrack(lookupSong, Array.isArray(records) ? records : []);
  if (match.status === 'not_found') {
    const asciiTitle = normalizeMusicText(song.title);
    if (asciiTitle && asciiTitle !== song.title.toLocaleLowerCase('vi-VN')) {
      await waitForLyricsRetry(550);
      const fallbackRecords = await lrclibRequest('/api/search', { ...searchParams, track_name: asciiTitle });
      if (Array.isArray(fallbackRecords)) records = [...(Array.isArray(records) ? records : []), ...fallbackRecords];
      match = chooseLrclibTrack(lookupSong, records);
    }
  }
  if (match.status === 'not_found') {
    await waitForLyricsRetry(550);
    const query = [song.title, lookupSong.artist || lookupSong.composer].filter(Boolean).join(' ');
    const fallbackRecords = await lrclibRequest('/api/search', { q: query });
    if (Array.isArray(fallbackRecords)) records = [...(Array.isArray(records) ? records : []), ...fallbackRecords];
    const uniqueRecords = [...new Map(records.map((record) => [record.id, record])).values()];
    match = chooseLrclibTrack(lookupSong, uniqueRecords);
  }
  if (match.status !== 'matched') return { ...match, provider: 'lrclib' };
  const track = match.track;
  const plainLyrics = String(track.plainLyrics || '').trim();
  const syncedLyrics = String(track.syncedLyrics || '').trim();
  const lyrics = plainLyrics || stripLrcTimestamps(syncedLyrics);
  if (!lyrics || track.instrumental) {
    return { status: 'not_found', reason: 'LRCLIB không có lời văn bản cho bản ghi này.', provider: 'lrclib' };
  }
  return {
    status: 'matched',
    provider: 'lrclib',
    lyrics,
    syncedLyrics,
    lyricsfile: String(track.lyricsfile || ''),
    track,
    score: match.score,
    attribution: lyricsAttribution('lrclib')
  };
}

async function resolveZingLrcLyrics(song, referenceLyrics = '') {
  try {
    zingLrcManifestPromise ||= readFile(karaokeLrcManifestPath, 'utf8').then(JSON.parse);
    const manifest = await zingLrcManifestPromise;
    const entry = manifest?.entries?.[song.songId];
    if (!entry || !/^https:\/\/static-zmp3\.zmdcdn\.me\/lyrics\//i.test(entry.url || '') || !entry.sourceTrackId) {
      return { status: 'not_found', reason: 'Chưa có nguồn LRC đã khớp lời cho bài này.', provider: 'zing-lrc' };
    }
    const cached = zingLrcCache.get(song.songId);
    if (cached && cached.expiresAt > Date.now()) return cached.result;

    const response = await fetch(entry.url, {
      headers: { Accept: 'text/plain', 'User-Agent': lrclibUserAgent },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return { status: 'not_found', reason: `Nguồn LRC phản hồi HTTP ${response.status}.`, provider: 'zing-lrc' };
    const rawLrc = await response.text();
    if (rawLrc.length > 1_000_000) return { status: 'not_found', reason: 'Nguồn LRC vượt quá giới hạn kích thước.', provider: 'zing-lrc' };
    const timedLines = parseSyncedKaraokeLyrics(rawLrc);
    if (timedLines.length < 2) return { status: 'not_found', reason: 'Nguồn LRC không có đủ timestamp.', provider: 'zing-lrc' };

    const staticLyrics = await localLyricsText(song.songId) || String(referenceLyrics || '');
    const lyrics = timedLines.map((line) => line.text).join('\n');
    if (!staticLyrics.trim() || !lyricsTextMatches(staticLyrics, lyrics)) {
      return { status: 'needs_verification', reason: 'Lời LRC không khớp đủ với lời đang có; không tự ghép timestamp.', provider: 'zing-lrc' };
    }
    const result = {
      status: 'matched',
      provider: 'zing-lrc',
      lyrics,
      syncedLyrics: rawLrc,
      track: {
        id: String(entry.sourceTrackId),
        artistName: String(entry.artist || ''),
        duration: Number(entry.durationSeconds)
      },
      score: 1,
      attribution: lyricsAttribution('zing-lrc'),
      sourceUrl: entry.url,
      cacheAllowed: false
    };
    zingLrcCache.set(song.songId, { result, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
    return result;
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return { status: 'not_found', reason: 'Nguồn LRC hết thời gian chờ.', provider: 'zing-lrc' };
    }
    return { status: 'not_found', reason: 'Không đọc được nguồn LRC.', provider: 'zing-lrc' };
  }
}

async function resolveMusixmatchLyrics(song) {
  const search = await musixmatchRequest('track.search', {
    q_track: song.title,
    ...(song.artist || song.composer ? { q_artist: song.artist || song.composer } : {}),
    page_size: '10',
    f_has_lyrics: '1',
    s_track_rating: 'desc'
  });
  const tracks = Array.isArray(search.track_list) ? search.track_list : [];
  const match = chooseMusixmatchTrack(song, tracks);
  if (match.status !== 'matched') return { ...match, provider: 'musixmatch' };
  const lyricsBody = await musixmatchRequest('track.lyrics.get', { track_id: String(match.track.track_id) });
  const lyricsRecord = lyricsBody.lyrics_list?.[0]?.lyrics;
  const lyrics = cleanMusixmatchLyrics(lyricsRecord?.lyrics_body);
  if (!lyrics || lyricsRecord?.restricted || /\.\.\.$/.test(lyrics)) {
    return { status: 'needs_verification', reason: 'Nguồn chỉ trả đoạn trích hoặc giới hạn quyền hiển thị.', provider: 'musixmatch' };
  }
  return {
    status: 'matched',
    provider: 'musixmatch',
    lyrics,
    score: match.score,
    track: match.track,
    attribution: lyricsAttribution('musixmatch')
  };
}

async function resolveLyrics(song, referenceLyrics = '') {
  if (lyricsProvider === 'lrclib') {
    let lrclib;
    try {
      lrclib = await resolveLrclibLyrics(song);
    } catch (error) {
      lrclib = { status: 'provider_error', reason: error.message || 'LRCLIB không phản hồi.', provider: 'lrclib' };
    }
    const hasSyncedLyrics = parseSyncedKaraokeLyrics(lrclib.syncedLyrics).length >= 2;
    if (lrclib.status === 'matched' && hasSyncedLyrics) {
      const staticLyrics = await localLyricsText(song.songId) || String(referenceLyrics || '');
      if (staticLyrics.trim() && lyricsTextMatches(staticLyrics, lrclib.lyrics)) return lrclib;
      const zing = await resolveZingLrcLyrics(song, referenceLyrics);
      if (zing.status === 'matched') return zing;
      return {
        ...lrclib,
        status: 'needs_verification',
        reason: 'Không có lời tham chiếu khớp đủ để xác minh LRC; chỉ giữ lời tĩnh.',
        syncedLyrics: ''
      };
    }
    const zing = await resolveZingLrcLyrics(song, referenceLyrics);
    return zing.status === 'matched' ? zing : lrclib;
  }
  if (lyricsProvider === 'link') {
    return {
      status: 'link_only',
      ...lyricsSourceForSong(song),
      reason: 'Chưa cấu hình API lời bài hát; mở nguồn bên ngoài để xem trực tiếp.'
    };
  }
  if (lyricsProvider !== 'musixmatch') throw new Error(`LYRICS_PROVIDER chưa hỗ trợ: ${lyricsProvider}`);
  return resolveMusixmatchLyrics(song);
}

async function syncOneLyrics(song) {
  const existing = await readStoredLyrics(song.songId);
  const existingText = String(existing?.lyrics_text || existing?.lyrics || '').trim();
  if (!lyricsProviderConfigured) {
    return {
      status: 'link_only',
      ...lyricsSourceForSong(song),
      reason: 'Chưa cấu hình API lời bài hát; mở nguồn bên ngoài để xem trực tiếp.'
    };
  }
  const resolved = await resolveLyrics(song, existingText);
  if (resolved.status === 'link_only') return existing ? { ...resolved, status: 'skipped', entry: existing } : resolved;
  if (resolved.status !== 'matched') return existing ? { ...resolved, status: 'skipped', entry: existing } : resolved;
  if (existingText && !lyricsTextMatches(existingText, resolved.lyrics)) {
    return { status: 'skipped', reason: 'Lời có timestamp không khớp lời đang lưu; giữ nguyên để tránh chạy sai bài.', entry: existing };
  }
  const entry = {
    songId: song.songId,
    title: song.title,
    artist: resolved.track?.artist_name || song.artist || song.composer || '',
    lyrics: existingText || resolved.lyrics,
    syncedLyrics: '',
    source: resolved.provider,
    providerTrackId: String(resolved.track.track_id || resolved.track.id),
    albumName: resolved.track?.album_name || resolved.track?.albumName || '',
    durationSeconds: null,
    hasWordSync: false,
    matchScore: resolved.score,
    verificationStatus: 'verified',
    attribution: resolved.attribution,
    cacheAllowed: resolved.provider === 'zing-lrc' ? false : lyricsCacheAllowed
  };
  if (!lyricsCacheAllowed || entry.cacheAllowed !== true) return { ...resolved, status: 'display_only', entry };
  const stored = await writeStoredLyrics(entry);
  return { ...resolved, status: 'saved', entry: stored || entry };
}

function lyricsResultPayload(song, result) {
  const entry = result.entry;
  return {
    ok: true,
    songId: song.songId,
    title: song.title,
    status: result.status,
    reason: result.reason || '',
    lyrics: entry?.lyrics_text || entry?.lyrics || result.lyrics || '',
    syncedLyrics: '',
    artist: entry?.artist || result.track?.artistName || result.track?.artist_name || '',
    source: entry?.source || result.provider || '',
    sourceUrl: result.sourceUrl || '',
    sourceName: result.sourceName || (result.provider === 'lrclib' ? 'LRCLIB' : result.provider === 'zing-lrc' ? 'Zing MP3' : ''),
    attribution: entry?.attribution || result.attribution || '',
    providerTrackId: entry?.provider_track_id || result.track?.id || result.track?.track_id || '',
    albumName: entry?.album_name || result.track?.albumName || result.track?.album_name || '',
    durationSeconds: null,
    hasWordSync: false,
    wordSyncLines: [],
    cacheable: (result.status === 'saved' || result.status === 'skipped')
      && entry?.cacheAllowed !== false
      && (entry?.cache_allowed === true || lyricsCacheAllowed),
    matchScore: result.score || entry?.match_score || 0
  };
}

async function ensureChatStorageBucket() {
  if (!supabaseConfigured) throw new Error('Supabase chưa được cấu hình để lưu ảnh chat.');
  if (!chatStorageReadyPromise) {
    chatStorageReadyPromise = (async () => {
      const headers = { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}` };
      const existing = await fetch(`${supabaseUrl}/storage/v1/bucket/${CHAT_STORAGE_BUCKET}`, { headers });
      if (existing.ok) return;
      const created = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: CHAT_STORAGE_BUCKET,
          name: CHAT_STORAGE_BUCKET,
          public: true,
          file_size_limit: CHAT_IMAGE_MAX_BYTES,
          allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
        })
      });
      if (!created.ok && created.status !== 409) {
        const detail = await created.text();
        throw new Error(`Không tạo được kho ảnh chat (${created.status}): ${detail.slice(0, 180)}`);
      }
    })().catch((error) => {
      chatStorageReadyPromise = null;
      throw error;
    });
  }
  return chatStorageReadyPromise;
}

async function uploadChatImage(dataUrl) {
  if (!supabaseConfigured) throw new Error('Cần cấu hình Supabase để gửi và lưu ảnh chat.');
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('Ảnh chưa đúng định dạng JPG, PNG, WEBP hoặc GIF.');
  const mimeType = match[1];
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length || buffer.length > CHAT_IMAGE_MAX_BYTES) {
    throw new Error('Ảnh quá lớn, hãy chọn ảnh nhỏ hơn 6 MB nha.');
  }
  await ensureChatStorageBucket();
  const extension = mimeType.split('/')[1].replace('jpeg', 'jpg');
  const filePath = `${vietnamDateKey()}/${randomUUID()}.${extension}`;
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${CHAT_STORAGE_BUCKET}/${filePath}`, {
    method: 'POST',
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      'Content-Type': mimeType,
      'x-upsert': 'false',
      'cache-control': '31536000'
    },
    body: buffer
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Chưa tải được ảnh lên Supabase (${response.status}): ${detail.slice(0, 180)}`);
  }
  return `${supabaseUrl}/storage/v1/object/public/${CHAT_STORAGE_BUCKET}/${filePath}`;
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
  if (code === 'D') return 'đi làm ca D, 07:30–20:00';
  if (code === 'N') return 'đi làm ca N, 19:30–07:30 hôm sau';
  if (code === 'HC') return 'đi làm ca hành chính, 07:30–16:30';
  if (code === '18' || code === '9') return 'được nghỉ';
  if (code === 'eAD') return 'có lịch điều chỉnh eAD';
  return null;
}

function prettyDate(key) {
  const [, month, day] = key.split('-');
  return `${day}/${month}`;
}

function scheduleEntries(schedule) {
  return Object.entries(schedule || {})
    .filter(([dateKey, code]) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && ['D', 'N', 'HC', '18', '9', 'eAD'].includes(code))
    .slice(0, 500);
}

async function readSharedSchedule() {
  const schedule = { ...defaultSchedule };
  let hasStoredEntries = false;
  let updatedAt = null;
  if (supabaseConfigured) {
    const rows = await supabaseRequest('schedule_entries?select=date_key,code,updated_at&order=date_key.asc');
    (rows || []).forEach((row) => {
      schedule[row.date_key] = row.code;
      hasStoredEntries = true;
      if (row.updated_at && (!updatedAt || row.updated_at > updatedAt)) updatedAt = row.updated_at;
    });
  } else if (pool) {
    await databaseReady;
    const result = await pool.query('SELECT date_key, code, updated_at FROM schedule_entries ORDER BY date_key ASC');
    result.rows.forEach((row) => {
      schedule[row.date_key] = row.code;
      hasStoredEntries = true;
      if (row.updated_at && (!updatedAt || row.updated_at > updatedAt)) updatedAt = row.updated_at;
    });
  } else {
    Object.assign(schedule, memorySchedule);
    hasStoredEntries = Object.keys(memorySchedule).length > 0;
    updatedAt = memoryScheduleUpdatedAt;
  }
  return { schedule, hasStoredEntries, updatedAt, storageMode: pool || supabaseConfigured ? 'persistent' : 'memory' };
}

async function writeSharedSchedule(schedule) {
  const entries = scheduleEntries(schedule);
  if (!entries.length) throw new Error('Lịch chưa có dữ liệu hợp lệ.');
  if (supabaseConfigured) {
    await supabaseRequest('schedule_entries?on_conflict=date_key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(entries.map(([date_key, code]) => ({ date_key, code })))
    });
    return;
  }
  if (pool) {
    await databaseReady;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [dateKey, code] of entries) {
        await client.query(
          `INSERT INTO schedule_entries (date_key, code, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (date_key) DO UPDATE SET code = EXCLUDED.code, updated_at = NOW()`,
          [dateKey, code]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return;
  }
  entries.forEach(([dateKey, code]) => { memorySchedule[dateKey] = code; });
  memoryScheduleUpdatedAt = new Date().toISOString();
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

function isSignedRoleRequest(request, role) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  try {
    const expectedSignature = createHmac('sha256', adminSessionSecret).update(payload).digest('base64url');
    const providedBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expectedSignature);
    if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) return false;
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.role === role && Number(session.exp) > Date.now();
  } catch {
    return false;
  }
}

function createSessionToken(role) {
  const payload = Buffer.from(JSON.stringify({
    role,
    exp: Date.now() + adminSessionTtlMs
  })).toString('base64url');
  const signature = createHmac('sha256', adminSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function createAudioStreamTicket(songId) {
  const ttlSeconds = 6 * 60 * 60;
  const payload = Buffer.from(JSON.stringify({ songId, exp: Date.now() + ttlSeconds * 1000 })).toString('base64url');
  const signature = createHmac('sha256', adminSessionSecret).update(`audio-stream:${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}

function isValidAudioStreamTicket(ticket, songId) {
  const [payload, signature] = String(ticket || '').split('.');
  if (!payload || !signature) return false;
  try {
    const expected = createHmac('sha256', adminSessionSecret).update(`audio-stream:${payload}`).digest('base64url');
    const providedBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) return false;
    const ticketData = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return ticketData.songId === songId && Number(ticketData.exp) > Date.now();
  } catch {
    return false;
  }
}

function isAdminRequest(request) {
  return isSignedRoleRequest(request, 'admin');
}

function isVyRequest(request) {
  return isSignedRoleRequest(request, 'vy');
}

function sessionRole(request) {
  if (isAdminRequest(request)) return 'admin';
  if (isVyRequest(request)) return 'vy';
  return null;
}

function requireSession(request, response, expectedRole = null) {
  const role = sessionRole(request);
  if (!role) {
    response.status(401).json({ code: 'SESSION_REQUIRED', error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });
    return null;
  }
  if (expectedRole && role !== expectedRole) {
    response.status(403).json({ code: 'ROLE_FORBIDDEN', error: 'Tài khoản này không có quyền thực hiện thao tác.' });
    return null;
  }
  return role;
}

function loginIsLimited(username) {
  const key = String(username || '').trim().toLocaleLowerCase('vi-VN').slice(0, 120);
  const now = Date.now();
  if (loginAttempts.size > 1000) {
    for (const [attemptKey, attempt] of loginAttempts) {
      if (now - attempt.startedAt >= LOGIN_WINDOW_MS) loginAttempts.delete(attemptKey);
    }
  }
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.startedAt >= LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { startedAt: now, count: 0 });
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function recordLoginFailure(username) {
  const key = String(username || '').trim().toLocaleLowerCase('vi-VN').slice(0, 120);
  const current = loginAttempts.get(key) || { startedAt: Date.now(), count: 0 };
  if (Date.now() - current.startedAt >= LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { startedAt: Date.now(), count: 1 });
  } else {
    current.count += 1;
    loginAttempts.set(key, current);
  }
}

function clearLoginFailures(username) {
  loginAttempts.delete(String(username || '').trim().toLocaleLowerCase('vi-VN').slice(0, 120));
}

function loginIsConfigured(role) {
  return credentialConfigError.length === 0 && (role === 'admin' ? Boolean(adminUsername && adminPassword) : Boolean(vyUsername && vyPassword));
}

function credentialsMatch(provided, expected) {
  if (!expected) return false;
  const a = Buffer.from(String(provided ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function awsEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function signR2GetUrl(objectKey, expiresInSeconds = r2UrlTtlSeconds) {
  if (!r2Configured) throw new Error('R2 chÆ°a Ä‘Æ°á»£c cáº¥u hÃ¬nh trÃªn server.');
  const host = `${r2AccountId}.r2.cloudflarestorage.com`;
  const path = `/${awsEncode(r2BucketName)}/${objectKey.split('/').map(awsEncode).join('/')}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const query = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${r2AccessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresInSeconds)],
    ['X-Amz-SignedHeaders', 'host']
  ].map(([key, value]) => [awsEncode(key), awsEncode(value)]).sort(([a], [b]) => a.localeCompare(b));
  const canonicalQuery = query.map(([key, value]) => `${key}=${value}`).join('&');
  const canonicalRequest = ['GET', path, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${r2SecretAccessKey}`, dateStamp), 'auto'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
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
  let code;
  try { code = getScheduleCode((await readSharedSchedule()).schedule, dateKey); }
  catch (error) { console.error('Không đọc được lịch để gửi nhắc:', error.message); }
  const description = shiftDescription(code) || 'chưa có dữ liệu lịch';
  const dateText = prettyDate(dateKey);
  const greeting = await generateCuteMessage(moment, dateText, description);
  const scheduleText = moment === 'evening' ? `Ngày mai ${dateText} ${description}.` : `Hôm nay ${dateText} ${description}.`;
  const body = `${greeting} ${scheduleText}`;
  const payload = JSON.stringify({
    title: notificationTitles[moment],
    body,
    tag: `lich-${moment}-${dateKey}`,
    url: '/?section=calendar'
  });
  await sendToRole('vy', payload);
}

app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_request, response) => response.json({
  ok: true,
  pushConfigured,
  database: Boolean(pool),
  scheduleStorage: pool || supabaseConfigured ? 'persistent' : 'memory',
  supabaseConfigured,
  livekitConfigured,
  geminiConfigured: Boolean(geminiApiKey),
  lyricsProvider,
  lyricsProviderConfigured,
  lyricsPersistenceAllowed,
  lyricsCacheAllowed,
  lyricsStorage: pool ? 'postgres.song_lyrics' : 'memory-only',
  lyricsPublicLookupEnabled,
  lyricsLinkFallback: true
}));

async function localProjectAudioForEntry(entry) {
  if (entry?.localPlayback !== true) return null;
  const sourceFile = entry.sourceFile;
  if (typeof sourceFile !== 'string' || basename(sourceFile) !== sourceFile || extname(sourceFile).toLowerCase() !== '.mp3') {
    throw new Error('Unsafe local audio filename.');
  }
  const filePath = resolve(projectRoot, sourceFile);
  let resolvedPath;
  try {
    resolvedPath = await realpath(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const relativePath = relative(projectRoot, resolvedPath);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) throw new Error('Local audio path escapes the project root.');
  let fileInfo;
  try {
    fileInfo = await stat(resolvedPath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!fileInfo.isFile() || fileInfo.size < 16_000) throw new Error('Local audio file is missing or too small.');
  return { filePath: resolvedPath, fileInfo };
}

async function readAudioManifestWithLocalOverrides() {
  const manifest = JSON.parse(await readFile(audioManifestPath, 'utf8'));
  let overrides;
  try {
    overrides = JSON.parse(await readFile(localAudioOverridesPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return manifest;
    throw error;
  }
  if (overrides?.schemaVersion !== 1 || !overrides.entries || typeof overrides.entries !== 'object') {
    throw new Error('Invalid local audio overrides manifest.');
  }
  for (const [songId, entry] of Object.entries(overrides.entries)) {
    if (entry?.songId !== songId || typeof entry.sourceFile !== 'string'
      || entry.objectKey !== `audio/${songId}.mp3` || entry.mimeType !== 'audio/mpeg'
      || entry.localPlayback !== true) throw new Error(`Invalid local audio override for ${songId}.`);
    manifest.entries[songId] = { ...manifest.entries[songId], ...entry };
  }
  return manifest;
}

function streamLocalProjectAudio(request, response, localAudio) {
  const { filePath, fileInfo } = localAudio;
  const size = fileInfo.size;
  let start = 0;
  let end = size - 1;
  let status = 200;
  const rangeHeader = request.headers.range;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match || (!match[1] && !match[2])) {
      response.set('Content-Range', `bytes */${size}`);
      return response.status(416).end();
    }
    if (!match[1]) {
      const suffixLength = Number(match[2]);
      if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
        response.set('Content-Range', `bytes */${size}`);
        return response.status(416).end();
      }
      start = Math.max(0, size - suffixLength);
    } else {
      start = Number(match[1]);
      if (match[2]) end = Number(match[2]);
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
      response.set('Content-Range', `bytes */${size}`);
      return response.status(416).end();
    }
    end = Math.min(end, size - 1);
    status = 206;
    response.set('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  response.set({
    'Content-Type': 'audio/mpeg',
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
    'Last-Modified': fileInfo.mtime.toUTCString()
  });
  response.status(status);
  const stream = createReadStream(filePath, { start, end });
  stream.on('error', (error) => {
    console.error('Local audio stream read failed:', error.message);
    if (!response.headersSent) response.status(500).end();
    else if (!response.destroyed) response.destroy(error);
  });
  stream.pipe(response);
  return undefined;
}

app.get('/api/audio/url/:songId', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  if (!isAdminRequest(request) && !isVyRequest(request)) {
    return response.status(401).json({ code: 'AUDIO_AUTH_REQUIRED', error: 'Phiên đăng nhập không hợp lệ để nghe audio riêng tư.' });
  }
  const song = karaokeSongById(request.params.songId);
  if (!song) return response.status(404).json({ code: 'SONG_NOT_FOUND', error: 'Không tìm thấy bài karaoke này.' });
  try {
    const manifest = await readAudioManifestWithLocalOverrides();
    const entry = manifest?.schemaVersion === 1 ? manifest.entries?.[song.songId] : null;
    if (!entry) {
      return response.status(404).json({ code: 'AUDIO_NOT_FOUND', error: 'Chưa có audio được ghép với bài này trong manifest.' });
    }
    const expectedPrefix = `audio/${song.songId}.`;
    if (entry.songId && entry.songId !== song.songId || typeof entry.objectKey !== 'string'
      || !entry.objectKey.startsWith(expectedPrefix) || entry.objectKey.includes('..')
      || typeof entry.mimeType !== 'string' || !entry.mimeType.startsWith('audio/')) {
      return response.status(503).json({ code: 'AUDIO_MANIFEST_INVALID', error: 'Manifest audio không khớp songId hoặc MIME type; đã chặn phát nhầm bài.' });
    }
    let localAudio = null;
    try {
      localAudio = await localProjectAudioForEntry(entry);
    } catch (error) {
      console.error(`Local audio manifest entry invalid for ${song.songId}:`, error.message);
      return response.status(503).json({ code: 'LOCAL_AUDIO_INVALID', error: 'File audio trong project không hợp lệ.' });
    }
    if (!localAudio && entry.localOnly === true) return response.status(404).json({
      code: 'AUDIO_NOT_FOUND', error: 'File audio cục bộ của bài này chưa có trong project.'
    });
    if (!r2Configured && !localAudio) return response.status(503).json({
      code: 'PRIVATE_AUDIO_NOT_CONFIGURED',
      error: 'Audio chưa sẵn sàng: server thiếu các biến R2 riêng tư.'
    });
    return response.json({
      songId: song.songId,
      audioUrl: `/api/audio/stream/${encodeURIComponent(song.songId)}?ticket=${encodeURIComponent(createAudioStreamTicket(song.songId))}`,
      mimeType: entry.mimeType,
      audioSource: localAudio ? 'local-project' : 'cloudflare-r2-private',
      durationSeconds: Number(entry.durationSeconds) || null,
      expiresInSeconds: 6 * 60 * 60
    });
  } catch (error) {
    console.error('Không đọc được audio manifest:', error.message);
    return response.status(503).json({ code: 'AUDIO_MANIFEST_UNAVAILABLE', error: 'Chưa đọc được manifest audio riêng tư.' });
  }
});

app.get('/api/audio/stream/:songId', async (request, response) => {
  response.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  const songId = request.params.songId;
  if (!isValidAudioStreamTicket(request.query.ticket, songId)) {
    return response.status(401).json({ code: 'AUDIO_STREAM_TICKET_INVALID', error: 'Đường dẫn nghe audio đã hết hạn.' });
  }
  const song = karaokeSongById(songId);
  if (!song) return response.status(404).end();

  let manifest;
  try {
    manifest = await readAudioManifestWithLocalOverrides();
  } catch {
    return response.status(503).end();
  }
  const entry = manifest?.schemaVersion === 1 ? manifest.entries?.[songId] : null;
  if (!entry || (entry.songId && entry.songId !== songId)
    || typeof entry.objectKey !== 'string' || !entry.objectKey.startsWith(`audio/${songId}.`)
    || entry.objectKey.includes('..') || typeof entry.mimeType !== 'string' || !entry.mimeType.startsWith('audio/')) {
    return response.status(404).end();
  }
  try {
    const localAudio = await localProjectAudioForEntry(entry);
    if (localAudio) return streamLocalProjectAudio(request, response, localAudio);
  } catch (error) {
    console.error(`Local audio stream unavailable for ${songId}:`, error.message);
    return response.status(503).end();
  }
  if (entry.localOnly === true) return response.status(404).end();
  if (!r2Configured) return response.status(503).end();

  const abortController = new AbortController();
  response.on('close', () => {
    if (!response.writableFinished) abortController.abort();
  });
  try {
    const headers = {};
    if (request.headers.range) headers.Range = request.headers.range;
    const upstream = await fetch(signR2GetUrl(entry.objectKey), { headers, signal: abortController.signal });
    if (upstream.status !== 200 && upstream.status !== 206 && upstream.status !== 416) {
      await upstream.body?.cancel();
      return response.status(upstream.status === 404 ? 404 : 502).end();
    }
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = upstream.headers.get(header);
      if (value) response.set(header, value);
    }
    response.status(upstream.status);
    if (upstream.status === 416 || !upstream.body) return response.end();
    Readable.fromWeb(upstream.body).on('error', (error) => {
      if (!response.destroyed) response.destroy(error);
    }).pipe(response);
  } catch (error) {
    if (error.name === 'AbortError' || response.destroyed) return;
    if (response.headersSent) response.destroy(error);
    else response.status(502).end();
  }
});

app.get('/api/lyrics/source/:songId', (request, response) => {
  const song = karaokeSongById(request.params.songId);
  if (!song) return response.status(404).json({ error: 'Không tìm thấy bài hát.' });
  return response.json({ ok: true, songId: song.songId, title: song.title, artist: song.artist || song.composer || '', ...lyricsSourceForSong(song) });
});

app.get('/api/karaoke/metadata/:songId', async (request, response) => {
  const song = karaokeSongById(request.params.songId);
  if (!song) return response.status(404).json({ error: 'KhÃ´ng tÃ¬m tháº¥y bÃ i hÃ¡t.' });
  const cached = karaokeMetadataCache.get(song.songId);
  if (cached && cached.expiresAt > Date.now()) return response.json(cached.data);
  try {
    const manifest = await readAudioManifestWithLocalOverrides();
    const entry = manifest.entries?.[song.songId];
    const sourceLabel = String(entry?.sourceFile || '').replace(/\s*\[[^\]]+\]\.(mp3|m4a|wav|flac|ogg)$/i, '');
    const sourceTitle = String(entry?.title || song.title);
    const split = sourceLabel.split(/\s+[—–|｜-]\s+/).filter(Boolean);
    const filenameArtist = split.length > 1 && normalizeMusicText(split[0]) !== normalizeMusicText(sourceTitle) ? split[0] : '';
    const sourceArtist = String(entry?.artist || filenameArtist || song.artist || song.composer || '').trim();
    let metadata = { songId: song.songId, title: sourceTitle, artist: sourceArtist, album: '', year: '', durationSeconds: null, coverUrl: '', artistImageUrl: '', artistImageSourceUrl: '', artistUrl: '', artworkCredit: '', artistImageCredit: '' };
    const query = [sourceArtist, sourceTitle].filter(Boolean).join(' ');
    const searchUrl = new URL('https://itunes.apple.com/search');
    searchUrl.search = new URLSearchParams({ term: query, entity: 'song', limit: '25', country: 'vn' });
    const searchResponse = await fetch(searchUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
    if (searchResponse.ok) {
      const results = (await searchResponse.json()).results || [];
      const titleKey = normalizeMusicText(sourceTitle);
      const artistKey = normalizeMusicText(sourceArtist);
      const exact = results.filter((item) => normalizeMusicText(item.trackName) === titleKey);
      const match = exact.find((item) => !artistKey || normalizeMusicText(item.artistName).includes(artistKey) || artistKey.includes(normalizeMusicText(item.artistName)))
        || (exact.length === 1 && !sourceArtist ? exact[0] : null);
      if (match) {
        metadata = {
          ...metadata,
          artist: match.artistName || metadata.artist,
          album: match.collectionName || '',
          year: match.releaseDate ? String(match.releaseDate).slice(0, 4) : '',
          durationSeconds: Number.isFinite(match.trackTimeMillis) ? Math.round(match.trackTimeMillis / 1000) : null,
          coverUrl: String(match.artworkUrl100 || '').replace(/^http:/i, 'https:').replace(/100x100bb/, '600x600bb'),
          artistUrl: String(match.artistViewUrl || ''),
          artworkCredit: 'Ảnh bìa: Apple Music/iTunes'
        };
      }
    }
    if (metadata.artist) {
      try {
        const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(metadata.artist.replace(/\s+/g, '_'))}`;
        const wikiResponse = await fetch(wikiUrl, { headers: { Accept: 'application/json', 'User-Agent': lrclibUserAgent }, signal: AbortSignal.timeout(5000) });
        if (wikiResponse.ok) {
          const article = await wikiResponse.json();
          const imageUrl = article.thumbnail?.source || article.originalimage?.source || '';
          if (article.type === 'standard' && normalizeMusicText(article.title) === normalizeMusicText(metadata.artist) && imageUrl.startsWith('https://')) {
            metadata.artistImageUrl = imageUrl;
            metadata.artistImageSourceUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(String(article.title).replace(/\s+/g, '_'))}`;
            metadata.artistImageCredit = 'Ảnh nghệ sĩ: Wikipedia';
          }
        }
      } catch { /* An artist photo is optional; the UI uses a designed fallback. */ }
    }
    const data = { ok: true, ...metadata };
    karaokeMetadataCache.set(song.songId, { data, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
    return response.json(data);
  } catch (error) {
    const data = { ok: true, songId: song.songId, title: song.title, artist: song.artist || song.composer || '', album: '', year: '', durationSeconds: null, coverUrl: '', artistImageUrl: '', artistImageSourceUrl: '', artistUrl: '', artworkCredit: '', artistImageCredit: '', metadataUnavailable: true };
    karaokeMetadataCache.set(song.songId, { data, expiresAt: Date.now() + 5 * 60 * 1000 });
    return response.json(data);
  }
});

app.get('/api/lyrics/:songId', async (request, response) => {
  const song = karaokeSongById(request.params.songId);
  if (!song) return response.status(404).json({ error: 'Không tìm thấy bài hát.' });
  try {
    const entry = await readStoredLyrics(song.songId);
    if (!entry || entry.cache_allowed === false) return response.status(404).json({ error: 'Bài này chưa có lời được lưu offline.' });
    return response.json({
      ok: true,
      songId: song.songId,
      title: entry.title || song.title,
      artist: entry.artist || song.artist || song.composer || '',
      lyrics: entry.lyrics_text,
      syncedLyrics: '',
      source: entry.source,
      providerTrackId: entry.provider_track_id,
      albumName: entry.album_name || '',
      durationSeconds: null,
      hasWordSync: false,
      attribution: entry.attribution,
      cacheable: true,
      updatedAt: entry.updated_at
    });
  } catch (error) {
    console.error('Không đọc được lyrics đã lưu:', error.message);
    return response.status(500).json({ error: 'Chưa đọc được lời bài hát đã lưu.' });
  }
});

app.get('/api/lyrics/resolve/:songId', async (request, response) => {
  if (!lyricsPublicLookupEnabled) return response.status(403).json({ error: 'Tra cứu lyrics trực tiếp đang tắt.' });
  const song = karaokeSongById(request.params.songId);
  if (!song) return response.status(404).json({ error: 'Không tìm thấy bài hát.' });
  try {
    const result = await syncOneLyrics(song);
    return response.json(lyricsResultPayload(song, result));
  } catch (error) {
    console.error(`Tra cứu LRCLIB thất bại cho ${song.songId}:`, error.message);
    return response.status(502).json({ error: error.message || 'Nguồn lyrics đang không phản hồi.' });
  }
});

app.post('/api/lyrics/sync-one', async (request, response) => {
  if (!isAdminRequest(request)) return response.status(401).json({ error: 'Cần đăng nhập góc quản trị để đồng bộ lời.' });
  const song = karaokeSongById(request.body?.songId);
  if (!song) return response.status(400).json({ error: 'songId không hợp lệ.' });
  try {
    const result = await syncOneLyrics(song);
    return response.json(lyricsResultPayload(song, result));
  } catch (error) {
    console.error(`Đồng bộ lyrics thất bại cho ${song.songId}:`, error.message);
    const status = /API_KEY|chưa hỗ trợ|chưa được cấu hình/i.test(error.message) ? 503 : 502;
    return response.status(status).json({ error: error.message || 'Nguồn lyrics đang không phản hồi.' });
  }
});

app.post('/api/admin/login', (request, response) => {
  const { username, password } = request.body || {};
  if (!loginIsConfigured('admin')) return response.status(503).json({ code: 'AUTH_CONFIG_MISSING', error: 'Máy chủ chưa cấu hình tài khoản quản trị. Hãy thêm ADMIN_USERNAME, ADMIN_PASSWORD và ADMIN_SESSION_SECRET.' });
  if (loginIsLimited(username)) return response.status(429).json({ code: 'LOGIN_RATE_LIMITED', error: 'Bạn đã thử quá nhiều lần. Hãy đợi 15 phút rồi thử lại.' });
  if (username !== adminUsername || !credentialsMatch(password, adminPassword)) {
    recordLoginFailure(username);
    return response.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu.' });
  }
  clearLoginFailures(username);
  const token = createSessionToken('admin');
  return response.set('Cache-Control', 'no-store').json({ ok: true, token, role: 'admin' });
});

app.post('/api/user/login', (request, response) => {
  const { username, password } = request.body || {};
  if (!loginIsConfigured('vy')) return response.status(503).json({ code: 'AUTH_CONFIG_MISSING', error: 'Máy chủ chưa cấu hình tài khoản Vy. Hãy thêm VY_USERNAME, VY_PASSWORD và ADMIN_SESSION_SECRET.' });
  if (loginIsLimited(username)) return response.status(429).json({ code: 'LOGIN_RATE_LIMITED', error: 'Bạn đã thử quá nhiều lần. Hãy đợi 15 phút rồi thử lại.' });
  if (username !== vyUsername || !credentialsMatch(password, vyPassword)) {
    recordLoginFailure(username);
    return response.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu.' });
  }
  clearLoginFailures(username);
  return response.set('Cache-Control', 'no-store').json({ ok: true, token: createSessionToken('vy'), role: 'vy' });
});

app.get('/api/session', (request, response) => {
  const role = sessionRole(request);
  if (!role) return response.status(401).json({ code: 'SESSION_REQUIRED', error: 'Phiên đăng nhập đã hết hạn.' });
  return response.set('Cache-Control', 'no-store').json({ ok: true, role });
});

app.post('/api/livekit/token', async (request, response) => {
  const role = requireSession(request, response);
  if (!role) return;
  const callType = request.body?.callType === 'voice' ? 'voice' : 'video';
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
        title: role === 'admin'
          ? `📞 Anh đang gọi ${callType === 'voice' ? 'thoại' : 'video'} cho Vy`
          : `📞 Vy đang gọi ${callType === 'voice' ? 'thoại' : 'video'} cho anh`,
        body: `Mở cuộc gọi đến để ${callType === 'voice' ? 'nhận cuộc gọi thoại' : 'bật camera và nhận video'} nha 💗`,
        tag: `video-call-${Date.now()}`,
        url: role === 'admin' ? `/?call=1&kind=${callType}` : `/?admin=1&call=1&kind=${callType}`,
        incomingCall: true,
        callerRole: role,
        callType
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

app.get('/api/schedule', async (request, response) => {
  const role = requireSession(request, response);
  if (!role) return;
  if (request.query.role && request.query.role !== role) return response.status(403).json({ code: 'ROLE_FORBIDDEN', error: 'Tài khoản này không có quyền xem lịch quản trị.' });
  try {
    return response.set('Cache-Control', 'no-store').json(await readSharedSchedule());
  } catch (error) {
    console.error('Không đọc được lịch dùng chung:', error.code || 'PostgreSQL/Supabase query failed');
    return response.set('Cache-Control', 'no-store').status(503).json({
      error: 'Chưa đọc được lịch của Vy.',
      fallback: true,
      schedule: { ...defaultSchedule }
    });
  }
});

app.put('/api/schedule', async (request, response) => {
  if (!requireSession(request, response)) return;
  try {
    await writeSharedSchedule(request.body?.schedule);
    return response.json({ ok: true, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Không đồng bộ được lịch:', error.message);
    return response.status(500).json({ error: 'Chưa đồng bộ được lịch của Vy.' });
  }
});

async function attachChatReactions(messages) {
  const result = messages.map((message) => ({ ...message, reactions: {} }));
  if (!result.length) return result;
  if (supabaseConfigured) {
    const rows = await supabaseRequest(`chat_message_reactions?select=message_id,role,reaction&message_id=in.(${result.map((message) => message.id).join(',')})`);
    const byId = new Map(result.map((message) => [String(message.id), message]));
    (rows || []).forEach((row) => { const message = byId.get(String(row.message_id)); if (message) message.reactions[row.role] = row.reaction; });
    return result;
  }
  if (pool) {
    await databaseReady;
    const rows = await pool.query('SELECT message_id, role, reaction FROM chat_message_reactions WHERE message_id = ANY($1::bigint[])', [result.map((message) => message.id)]);
    const byId = new Map(result.map((message) => [String(message.id), message]));
    rows.rows.forEach((row) => { const message = byId.get(String(row.message_id)); if (message) message.reactions[row.role] = row.reaction; });
    return result;
  }
  result.forEach((message) => { message.reactions = { ...(memoryChatReactions.get(String(message.id)) || {}) }; });
  return result;
}

async function attachChatReactionsSafe(messages) {
  try { return await attachChatReactions(messages); } catch (error) { console.warn('Reaction table chưa sẵn sàng:', error.message); return messages.map((message) => ({ ...message, reactions: {} })); }
}

app.get('/api/chat/messages', async (request, response) => {
  const viewerRole = requireSession(request, response);
  if (!viewerRole) return;
  if (request.query.role && request.query.role !== viewerRole) return response.status(403).json({ code: 'ROLE_FORBIDDEN', error: 'Tài khoản này không có quyền xem vai trò chat đó.' });
  try {
    if (supabaseConfigured) {
      const rows = await supabaseRequest('chat_messages?select=id,sender_role,content,created_at&order=id.desc&limit=100');
      return response.json({ messages: await attachChatReactionsSafe((rows || []).reverse()) });
    }
    if (pool) {
      await databaseReady;
      const result = await pool.query(
        `SELECT id, sender_role, content, created_at
         FROM chat_messages
         ORDER BY id DESC
         LIMIT 100`
      );
      return response.json({ messages: await attachChatReactionsSafe(result.rows.reverse()) });
    }
    return response.json({ messages: await attachChatReactionsSafe(memoryChatMessages.slice(-100)) });
  } catch (error) {
    console.error('Không đọc được lịch sử chat:', error.message);
    return response.status(500).json({ error: 'Chưa tải được lịch sử tin nhắn.' });
  }
});

app.post('/api/chat/messages', async (request, response) => {
  const senderRole = requireSession(request, response);
  if (!senderRole) return;
  if (request.body?.senderRole && request.body.senderRole !== senderRole) return response.status(403).json({ code: 'ROLE_FORBIDDEN', error: 'Không thể gửi tin nhắn thay cho tài khoản khác.' });
  const content = String(request.body?.content || '').trim().slice(0, 2000);
  const imageDataUrl = String(request.body?.imageDataUrl || '');
  if (!content && !imageDataUrl) return response.status(400).json({ error: 'Tin nhắn chưa có nội dung hoặc ảnh.' });

  try {
    let storedContent = content;
    if (imageDataUrl) {
      const imageUrl = await uploadChatImage(imageDataUrl);
      storedContent = `${CHAT_IMAGE_PREFIX}${JSON.stringify({ url: imageUrl, caption: content })}`;
    }
    let message;
    if (supabaseConfigured) {
      const rows = await supabaseRequest('chat_messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify({ sender_role: senderRole, content: storedContent })
      });
      message = rows?.[0];
    } else if (pool) {
      await databaseReady;
      const result = await pool.query(
        `INSERT INTO chat_messages (sender_role, content)
         VALUES ($1, $2)
         RETURNING id, sender_role, content, created_at`,
        [senderRole, storedContent]
      );
      message = result.rows[0];
    } else {
      message = {
        id: ++memoryChatMessageId,
        sender_role: senderRole,
        content: storedContent,
        created_at: new Date().toISOString()
      };
      memoryChatMessages.push(message);
      if (memoryChatMessages.length > 100) memoryChatMessages.shift();
    }

    const recipientRole = senderRole === 'vy' ? 'admin' : 'vy';
    const senderName = senderRole === 'vy' ? 'Vy' : 'Anh';
    const notificationBody = imageDataUrl
      ? `${senderName} vừa gửi một ảnh${content ? `: ${content.slice(0, 140)}` : ''} 📷`
      : `${senderName}: ${content.slice(0, 180)}`;
    await sendToRole(recipientRole, JSON.stringify({
      title: senderRole === 'vy' ? '💌 Vy vừa nhắn cho anh' : '💌 Anh vừa nhắn cho Vy',
      body: notificationBody,
      tag: `chat-message-${message.id}`,
      url: senderRole === 'vy' ? '/?admin=1&section=admin-chat' : '/?section=vy-chat'
    }));
    return response.status(201).json({ ok: true, message });
  } catch (error) {
    console.error('Không gửi được tin nhắn:', error.message);
    return response.status(500).json({ error: 'Chưa gửi được tin nhắn.' });
  }
});

app.post('/api/chat/messages/:messageId/reaction', async (request, response) => {
  const role = requireSession(request, response);
  if (!role) return;
  if (request.body?.role && request.body.role !== role) return response.status(403).json({ code: 'ROLE_FORBIDDEN', error: 'Không thể thả reaction thay cho tài khoản khác.' });
  const reaction = ['💗', '😂', '😮', '✨', '🥰'].includes(request.body?.reaction) ? request.body.reaction : '💗';
  try {
    if (supabaseConfigured) {
      await supabaseRequest('chat_message_reactions?on_conflict=message_id,role', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ message_id: Number(request.params.messageId), role, reaction }) });
    } else if (pool) {
      await databaseReady;
      await pool.query('INSERT INTO chat_message_reactions (message_id, role, reaction) VALUES ($1, $2, $3) ON CONFLICT (message_id, role) DO UPDATE SET reaction = EXCLUDED.reaction, updated_at = NOW()', [request.params.messageId, role, reaction]);
    } else {
      const reactions = memoryChatReactions.get(String(request.params.messageId)) || {};
      reactions[role] = reactions[role] === reaction ? null : reaction;
      memoryChatReactions.set(String(request.params.messageId), reactions);
    }
    return response.json({ ok: true, reaction });
  } catch (error) {
    console.error('Không lưu được reaction chat:', error.message);
    return response.status(500).json({ error: 'Chưa lưu được reaction. Nếu dùng Supabase, hãy chạy SQL trong README.' });
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
  const role = requireSession(request, response);
  if (!role) return;
  if (request.body?.role && request.body.role !== role) return response.status(403).json({ code: 'ROLE_FORBIDDEN', error: 'Không thể đăng ký thông báo cho tài khoản khác.' });
  const subscription = request.body?.subscription || request.body;
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
      url: role === 'admin' ? '/?admin=1&section=food-requests' : '/?section=calendar'
    }));
    return response.status(201).json({ ok: true });
  } catch (error) {
    console.error('Không lưu được đăng ký thông báo:', error.message);
    return response.status(500).json({ error: 'Could not save subscription.' });
  }
});

app.post('/api/food-requests', async (request, response) => {
  if (!requireSession(request, response, 'vy')) return;
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
      url: '/?admin=1&section=food-requests'
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
      url: '/?section=food'
    }));
    return response.json({ ok: true });
  } catch (error) {
    console.error('Không gửi được phản hồi món ăn:', error.message);
    return response.status(500).json({ error: 'Chưa gửi được phản hồi cho Vy.' });
  }
});

const { registerOfflineShellRoute } = await import('./offline-shell.js');
registerOfflineShellRoute(app, distRoot);

app.use(express.static(distRoot, { etag: false, maxAge: 0 }));
app.use((request, response) => {
  if (request.method !== 'GET') return response.status(404).json({ error: 'Not found.' });
  return response.sendFile(resolve(distRoot, 'index.html'));
});

cron.schedule('0 6 * * *', () => dispatchDailyReminder('morning'), { timezone: 'Asia/Ho_Chi_Minh' });
cron.schedule('0 12 * * *', () => dispatchDailyReminder('noon'), { timezone: 'Asia/Ho_Chi_Minh' });
cron.schedule('0 20 * * *', () => dispatchDailyReminder('evening'), { timezone: 'Asia/Ho_Chi_Minh' });

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Lịch của Vy đang chạy tại cổng ${port}. Push: ${pushConfigured ? 'đã cấu hình' : 'chưa cấu hình'}.`);
  if (!pool) console.warn('DATABASE_URL chưa có: đăng ký nhận nhắc sẽ mất khi Railway restart.');
});

export { app, server };
