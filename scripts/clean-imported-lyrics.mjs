import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNIQUE_KARAOKE_SONGS } from '../karaoke-data.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(projectRoot, 'data (1)', 'lyrics');
const outputRoot = path.join(projectRoot, 'public', 'lyrics');
const reportPath = path.join(sourceRoot, 'lyrics-cleanup-checklist.csv');

function normalizeTitle(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function songIdFromTitle(title) {
  return String(title)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function cleanLyrics(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\u2060]/g, '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/g, ''))
    .join('\n')
    .replace(/^\s*\n+|\n+\s*$/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

const songsByTitle = new Map();
for (const song of UNIQUE_KARAOKE_SONGS) {
  const key = normalizeTitle(song.title);
  if (!songsByTitle.has(key)) songsByTitle.set(key, song);
}

const sourceDirs = (await fs.readdir(sourceRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const records = [];
for (const category of sourceDirs) {
  const filenames = await fs.readdir(path.join(sourceRoot, category));
  for (const filename of filenames.filter((name) => name.endsWith('.json'))) {
    const record = await readJson(path.join(sourceRoot, category, filename));
    if (record.lyric?.trim()) records.push({ record, filename });
  }
}

const chosenBySongId = new Map();
const conflicts = new Set();
for (const { record, filename } of records) {
  const song = songsByTitle.get(normalizeTitle(record.input?.title));
  if (!song) continue;
  const songId = songIdFromTitle(song.title);
  const text = cleanLyrics(record.lyric);
  if (!text) continue;
  const current = chosenBySongId.get(songId);
  if (current && current.text !== text) conflicts.add(songId);
  if (!current || text.length > current.text.length) {
    chosenBySongId.set(songId, { text, title: song.title, filename });
  }
}

await fs.mkdir(outputRoot, { recursive: true });
for (const [songId, entry] of chosenBySongId) {
  await fs.writeFile(path.join(outputRoot, `${songId}.txt`), `${entry.text}\n`, 'utf8');
}

const checklist = await readJson(path.join(sourceRoot, 'index.json'));
const rows = [['title', 'category', 'status', 'app_song_id', 'cleaned_lyric', 'note']];
for (const entry of checklist) {
  const title = entry.input?.title ?? '';
  const song = songsByTitle.get(normalizeTitle(title));
  const songId = song ? songIdFromTitle(song.title) : '';
  const cleaned = Boolean(songId && chosenBySongId.has(songId));
  rows.push([
    title,
    entry.input?.category ?? '',
    entry.status ?? '',
    songId,
    cleaned ? 'yes' : 'no',
    cleaned ? (conflicts.has(songId) ? 'multiple source versions; longest retained' : '') : 'no matching non-empty lyric in supplied data',
  ]);
}

const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n');
await fs.writeFile(reportPath, `${csv}\r\n`, 'utf8');

const pending = rows.slice(1).filter((row) => row[4] === 'no').length;
console.log(JSON.stringify({
  checklistEntries: checklist.length,
  sourceRecordsWithLyrics: records.length,
  cleanedAppLyrics: chosenBySongId.size,
  pendingChecklistEntries: pending,
  conflictingSourceVersions: conflicts.size,
  outputRoot,
  reportPath,
}, null, 2));
