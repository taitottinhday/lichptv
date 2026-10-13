import { copyFile, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { UNIQUE_KARAOKE_SONGS } from '../karaoke-data.js';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifestPath = resolve(projectRoot, 'public/audio-manifest.json');
const catalogPath = resolve(projectRoot, 'data (1)/lyrics/catalog-all.json');
const applyChanges = process.argv.includes('--apply');

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi-VN')
    .replace(/\u0111/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const excludedArtistLabels = new Set([
  'anh trai say hi',
  'tinh ha say hi',
  'em xinh say hi',
  'nhieu nghe si'
]);
const alternateVersionPattern = /\b(remix|live|cover|acoustic|karaoke|instrumental|sped up|slowed|vietsub)\b/i;

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const localAudioFiles = (await readdir(projectRoot)).filter((file) => /\.mp3$/i.test(file));
const usedFiles = new Set(Object.values(manifest.entries || {}).map((entry) => entry.sourceFile));
const planned = [];
const review = [];

if (manifest.schemaVersion !== 1 || manifest.storage !== 'cloudflare-r2-private') {
  throw new Error('Unsupported audio manifest schema or storage configuration.');
}

for (const song of UNIQUE_KARAOKE_SONGS) {
  if (manifest.entries?.[song.songId]) continue;
  const normalizedTitle = normalize(song.title);
  const titleMatches = localAudioFiles.filter((file) => {
    const normalizedFile = normalize(file.replace(/\s*\[[^\]]+\]\.[^.]+$/i, ''));
    return !usedFiles.has(file) && ` ${normalizedFile} `.includes(` ${normalizedTitle} `);
  });
  if (!titleMatches.length) continue;

  const matchingRecords = catalog.filter((record) => normalize(record.title) === normalizedTitle);
  const artists = [...new Set(matchingRecords.flatMap((record) => (record.artists || [])
    .map((artist) => String(artist.name || '').trim())
    .filter((artist) => artist && !excludedArtistLabels.has(normalize(artist)))))];
  const artistMatches = titleMatches.map((file) => artists.filter((artist) =>
    ` ${normalize(file)} `.includes(` ${normalize(artist)} `)));
  const verifiedCandidates = titleMatches.filter((file, index) =>
    artistMatches[index]?.length && !alternateVersionPattern.test(normalize(file)));

  if (verifiedCandidates.length !== 1) {
    review.push({ songId: song.songId, title: song.title, candidates: titleMatches });
    continue;
  }

  const sourceFile = verifiedCandidates[0];
  if (basename(sourceFile) !== sourceFile) throw new Error(`Unsafe source filename for ${song.songId}.`);
  const sourcePath = resolve(projectRoot, sourceFile);
  const info = await stat(sourcePath);
  if (!info.isFile() || info.size < 16_000) throw new Error(`Invalid or empty MP3 for ${song.songId}.`);
  const data = await readFile(sourcePath);
  const validHeader = data.subarray(0, 3).toString('ascii') === 'ID3'
    || (data[0] === 0xff && [0xfb, 0xf3, 0xf2].includes(data[1]));
  if (!validHeader) throw new Error(`Source is not an MP3 for ${song.songId}.`);

  const entry = {
    songId: song.songId,
    objectKey: `audio/${song.songId}.mp3`,
    mimeType: 'audio/mpeg',
    title: song.title,
    artist: artistMatches[titleMatches.indexOf(sourceFile)].join(', '),
    sourceFile,
    matchMethod: 'exact-title-and-catalog-artist'
  };
  planned.push(entry);
  usedFiles.add(sourceFile);
}

console.log(JSON.stringify({
  mode: applyChanges ? 'apply' : 'dry-run',
  totalSongs: UNIQUE_KARAOKE_SONGS.length,
  existingMappings: Object.keys(manifest.entries || {}).length,
  proposedMappings: planned,
  needsReview: review,
  missingWithoutCandidate: UNIQUE_KARAOKE_SONGS.filter((song) => !manifest.entries?.[song.songId]
    && !planned.some((entry) => entry.songId === song.songId)
    && !review.some((entry) => entry.songId === song.songId)).map(({ songId, title }) => ({ songId, title }))
}, null, 2));

if (applyChanges && planned.length) {
  const backupPath = resolve(tmpdir(), `audio-manifest-${Date.now()}.json`);
  await copyFile(manifestPath, backupPath);
  for (const entry of planned) manifest.entries[entry.songId] = entry;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Updated ${manifestPath}; backup: ${backupPath}`);
}
