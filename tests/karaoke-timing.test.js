import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { activeLyricIndex, activeTimedLyricIndex, getLineProgress, getLineState, karaokeLyricsTextSimilarity, lrcLineIntervals, normalizeTimedLyrics, parseSyncedKaraokeLyrics, timingMatchesAudio, wordPlaybackState } from '../karaoke-timing.js';

// Explicit test-only timing fixture. These timestamps do not represent a real song.
const fixtureLrc = '[00:00.00]Mẫu lời một\n[00:01.00]Mẫu lời hai';
const fixtureWords = [
  { text: 'Mẫu', startMs: 0, endMs: 400 },
  { text: 'lời', startMs: 400, endMs: 800 },
  { text: 'một', startMs: 800, endMs: 1000 }
];

test('LRC fixture picks the active lyric line at exact playback time', () => {
  const lines = parseSyncedKaraokeLyrics(fixtureLrc);
  assert.deepEqual(lines, [
    { seconds: 0, text: 'Mẫu lời một' },
    { seconds: 1, text: 'Mẫu lời hai' }
  ]);
  assert.equal(activeLyricIndex(lines, 0.999), 0);
  assert.equal(activeLyricIndex(lines, 1), 1);
});

test('word fixture separates upcoming, progressive current, and sung states', () => {
  assert.deepEqual(wordPlaybackState(fixtureWords[0], -1), { state: 'upcoming', progress: 0 });
  assert.deepEqual(wordPlaybackState(fixtureWords[0], 200), { state: 'current', progress: 0.5 });
  assert.deepEqual(wordPlaybackState(fixtureWords[0], 400), { state: 'sung', progress: 1 });
});

test('pause, resume, and forward/backward seeks follow audio currentTime', () => {
  const lines = parseSyncedKaraokeLyrics(fixtureLrc);
  // A pause leaves currentTime unchanged, so the active word and line stay put.
  const pausedAtMs = 600;
  assert.equal(wordPlaybackState(fixtureWords[1], pausedAtMs).state, 'current');
  assert.equal(wordPlaybackState(fixtureWords[1], pausedAtMs).progress, 0.5);
  // Resume advances; a forward seek selects the later word/line.
  assert.equal(wordPlaybackState(fixtureWords[2], 900).state, 'current');
  assert.equal(activeLyricIndex(lines, 1.1), 1);
  // A backward seek recalculates from media time rather than retaining old UI state.
  assert.equal(wordPlaybackState(fixtureWords[0], 200).state, 'current');
  assert.equal(activeLyricIndex(lines, 0.2), 0);
});

test('switching tracks uses the new track timeline from its own start', () => {
  const nextTrack = parseSyncedKaraokeLyrics('[00:00.50]Lời bài mới\n[00:02.00]Câu kế tiếp');
  assert.equal(activeLyricIndex(nextTrack, 0.1), -1);
  assert.equal(activeLyricIndex(nextTrack, 0.5), 0);
});

test('LRC offset is applied to the audio timeline', () => {
  const lines = parseSyncedKaraokeLyrics('[offset:+500]\n[00:01.00]Lời đầu\n[00:02.25]Lời sau');
  assert.deepEqual(lines, [
    { seconds: 1.5, text: 'Lời đầu' },
    { seconds: 2.75, text: 'Lời sau' }
  ]);
  const earlyLines = parseSyncedKaraokeLyrics('[offset:-1500]\n[00:01.00]Bắt đầu sớm\n[00:02.00]Dòng kế tiếp');
  assert.equal(earlyLines[0].seconds, 0);
  assert.equal(earlyLines[1].seconds, 0.5);
});

test('line progress and state honor exact boundaries and clamp to the line interval', () => {
  const line = { start: 2, end: 6 };
  assert.equal(getLineProgress(1.9, line.start, line.end), 0);
  assert.equal(getLineState(1.9, line), 'upcoming');
  assert.equal(getLineProgress(2, line.start, line.end), 0);
  assert.equal(getLineState(2, line), 'active');
  assert.equal(getLineProgress(4, line.start, line.end), 0.5);
  assert.equal(getLineState(4, line), 'active');
  assert.equal(getLineProgress(6, line.start, line.end), 1);
  assert.equal(getLineState(6, line), 'done');
  assert.equal(getLineProgress(9, line.start, line.end), 1);
  assert.equal(getLineState(9, line), 'done');
});

test('invalid timing is discarded and explicit millisecond fields alone convert to seconds', () => {
  assert.deepEqual(normalizeTimedLyrics([
    { text: 'good', startMs: 1000, endMs: 2500 },
    { text: 'bad negative', start: -1, end: 2 },
    { text: 'bad range', start: 4, end: 4 },
    { text: '', start: 1, end: 2 },
    { text: 'bad numbers', start: Infinity, end: 2 }
  ]), [{ id: 'lyric-0-1', sourceIndex: 0, text: 'good', start: 1, end: 2.5 }]);
  assert.deepEqual(normalizeTimedLyrics([{ text: 'seconds stay seconds', start: 1000, end: 2500 }]), [
    { id: 'lyric-0-1000', sourceIndex: 0, text: 'seconds stay seconds', start: 1000, end: 2500 }
  ]);
  assert.equal(getLineProgress(Number.NaN, 1, 2), 0);
  assert.equal(getLineProgress(1, -1, 2), 0);
  assert.equal(getLineState(1, { start: 1, end: 0 }), 'upcoming');
});

test('LRC starts form approximate intervals only through the next line; the final line has no invented end', () => {
  const starts = parseSyncedKaraokeLyrics('[00:00.00]Câu 1\n[00:02.00]Câu 2\n[00:05.00]Câu 3');
  assert.deepEqual(lrcLineIntervals(starts), [
    { id: 'lrc-0-0', sourceIndex: 0, text: 'Câu 1', start: 0, end: 2 },
    { id: 'lrc-1-2', sourceIndex: 1, text: 'Câu 2', start: 2, end: 5 }
  ]);
  assert.deepEqual(lrcLineIntervals(parseSyncedKaraokeLyrics('plain lyrics')), []);
});

test('active line detects silence gaps, seeks forward and backward, and picks latest start on overlap', () => {
  const lines = [
    { start: 1, end: 2 },
    { start: 4, end: 5 },
    { start: 4.5, end: 6 }
  ];
  assert.equal(activeTimedLyricIndex(lines, 0), -1);
  assert.equal(activeTimedLyricIndex(lines, 1.5), 0);
  assert.equal(activeTimedLyricIndex(lines, 3), -1);
  assert.equal(activeTimedLyricIndex(lines, 4.25), 1);
  assert.equal(activeTimedLyricIndex(lines, 4.75), 2);
  assert.equal(activeTimedLyricIndex(lines, 1.5), 0); // backward seek recalculates from the media clock
});

test('progress freezes on pause and resumes or seeks only from the supplied audio clock', () => {
  const line = { start: 0, end: 4 };
  const pausedAt = 2;
  const pausedProgress = getLineProgress(pausedAt, line.start, line.end);
  assert.equal(getLineProgress(pausedAt, line.start, line.end), pausedProgress);
  assert.equal(getLineProgress(3, line.start, line.end), 0.75);
  assert.equal(getLineProgress(1, line.start, line.end), 0.25);
});

test('progressive timing requires the same track and a verified LRCLIB duration match', () => {
  const match = {
    songId: 'song-a', source: 'lrclib', providerTrackId: 'track-1', durationSeconds: 180,
    audioSongId: 'song-a', audioSrc: 'https://audio.example/song-a.mp3', audioDuration: 180.4
  };
  assert.equal(timingMatchesAudio(match), true);
  assert.equal(timingMatchesAudio({ ...match, audioSongId: 'song-b' }), false);
  assert.equal(timingMatchesAudio({ ...match, audioSrc: '' }), false);
  assert.equal(timingMatchesAudio({ ...match, source: 'user-lrc' }), false);
  assert.equal(timingMatchesAudio({ ...match, providerTrackId: '' }), false);
  assert.equal(timingMatchesAudio({ ...match, audioDuration: 185 }), false);
  assert.equal(timingMatchesAudio({ ...match, durationSeconds: null }), false);
});

test('verified Zing LRC timing uses the same strict active-audio duration checks', () => {
  const match = {
    songId: 'song-a', source: 'zing-lrc', providerTrackId: 'zing-track-1', durationSeconds: 185,
    audioSongId: 'song-a', audioSrc: 'https://audio.example/song-a.mp3', audioDuration: 185.4
  };
  assert.equal(timingMatchesAudio(match), true);
  assert.equal(timingMatchesAudio({ ...match, audioDuration: 190 }), false);
  assert.equal(timingMatchesAudio({ ...match, source: 'unverified-lrc' }), false);
});

test('Zing LRC manifest contains only entries verified against the existing static lyrics', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/karaoke-lrc-manifest.json', import.meta.url), 'utf8'));
  const entries = Object.values(manifest.entries || {});
  assert.equal(manifest.provider, 'zing-lrc');
  assert.equal(entries.length, 305);
  assert.ok(entries.every((entry) => entry.sourceTrackId && entry.durationSeconds > 0
    && /^https:\/\/static-zmp3\.zmdcdn\.me\/lyrics\//.test(entry.url)));
});

test('plain text has no inferred synchronization timestamps', () => {
  assert.deepEqual(parseSyncedKaraokeLyrics('Chỉ là lời văn bản\nKhông có mốc thời gian'), []);
});

test('lyrics with small transcription differences can still match while different lyrics do not', () => {
  const local = 'Mình yêu nhau từ kiếp nào em có nhớ không anh vẫn luôn chờ em quay về bên anh';
  const provider = 'Mình yêu nhau từ kiếp nào em có nhớ không anh vẫn luôn chờ em quay về bên nhau';
  const unrelated = 'Mưa rơi trên phố xưa lòng anh đau khi em đã xa nơi đây';
  assert.ok(karaokeLyricsTextSimilarity(local, provider) >= 0.9);
  assert.ok(karaokeLyricsTextSimilarity(local, unrelated) < 0.9);
});
