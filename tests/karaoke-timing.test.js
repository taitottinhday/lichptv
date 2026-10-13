import test from 'node:test';
import assert from 'node:assert/strict';
import { activeLyricIndex, parseSyncedKaraokeLyrics, wordPlaybackState } from '../karaoke-timing.js';

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

test('plain text has no inferred synchronization timestamps', () => {
  assert.deepEqual(parseSyncedKaraokeLyrics('Chỉ là lời văn bản\nKhông có mốc thời gian'), []);
});
