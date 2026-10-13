import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, basename } from 'node:path';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifestPath = resolve(projectRoot, 'public/audio-manifest.json');

async function loadLocalEnvironment() {
  let contents;
  try {
    contents = await readFile(resolve(projectRoot, '.env'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

await loadLocalEnvironment();
const { r2Configured, signR2Url } = await import('../r2-storage.mjs');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const entries = Object.values(manifest.entries || {});
const uploadRequested = process.argv.includes('--upload');
const limitArgument = process.argv.find((argument) => argument.startsWith('--limit='));
const uploadLimit = limitArgument ? Number(limitArgument.slice('--limit='.length)) : Infinity;
const songIdArgument = process.argv.find((argument) => argument.startsWith('--song-id='));
const selectedSongIds = songIdArgument?.slice('--song-id='.length).split(',').map((id) => id.trim()).filter(Boolean);
const concurrencyArgument = process.argv.find((argument) => argument.startsWith('--concurrency='));
const concurrency = concurrencyArgument ? Number(concurrencyArgument.slice('--concurrency='.length)) : 2;

if (!(uploadLimit > 0) || !(concurrency > 0)) throw new Error('Limit and concurrency must be positive numbers.');
if (!r2Configured) throw new Error('R2 credentials are missing. Configure them in a private .env or server environment.');
if (manifest.schemaVersion !== 1 || manifest.storage !== 'cloudflare-r2-private') throw new Error('Unsupported or non-private audio manifest.');

const songFilteredEntries = selectedSongIds?.length ? entries.filter((entry) => selectedSongIds.includes(entry.songId)) : entries;
const missingSongIds = (selectedSongIds || []).filter((songId) => !songFilteredEntries.some((entry) => entry.songId === songId));
if (missingSongIds.length) throw new Error(`songId is not in the audio manifest: ${missingSongIds.join(', ')}`);
const selectedEntries = songFilteredEntries.slice(0, uploadLimit);
const files = [];
for (const entry of selectedEntries) {
  if (!entry.songId || manifest.entries[entry.songId] !== entry
    || entry.objectKey !== `audio/${entry.songId}.mp3` || entry.mimeType !== 'audio/mpeg') {
    throw new Error(`Invalid manifest entry for ${entry.songId || 'unknown song'}.`);
  }
  if (typeof entry.sourceFile !== 'string' || basename(entry.sourceFile) !== entry.sourceFile) {
    throw new Error(`Missing safe source filename for ${entry.songId}.`);
  }
  const sourcePath = resolve(projectRoot, entry.sourceFile);
  const fileInfo = await stat(sourcePath);
  const file = await open(sourcePath, 'r');
  const header = Buffer.alloc(3);
  await file.read(header, 0, 3, 0);
  await file.close();
  const isMp3 = header.toString('ascii') === 'ID3'
    || (header[0] === 0xff && [0xfb, 0xf3, 0xf2].includes(header[1]));
  if (!fileInfo.isFile() || fileInfo.size < 16_000 || !isMp3) {
    throw new Error(`Source is missing, empty, or not an MP3 for ${entry.songId}.`);
  }
  files.push({ entry, sourcePath, size: fileInfo.size });
}

async function md5File(sourcePath) {
  const hash = createHash('md5');
  for await (const chunk of createReadStream(sourcePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function getObjectState(file) {
  const response = await fetch(signR2Url('GET', file.entry.objectKey), {
    headers: { Range: 'bytes=0-0' },
    signal: AbortSignal.timeout(30_000)
  });
  const status = response.status;
  const contentRange = response.headers.get('content-range') || '';
  const size = Number(contentRange.split('/')[1] || response.headers.get('content-length') || 0);
  const etag = (response.headers.get('etag') || '').replace(/^"|"$/g, '').toLowerCase();
  await response.body?.cancel();
  if (status === 404) return { exists: false };
  if (status !== 206 && status !== 200) throw new Error(`R2 object check returned HTTP ${status}.`);
  return { exists: true, status, size, etag };
}

async function withRetry(operation, label) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === 2 || (error.status && ![429, 500, 502, 503, 504].includes(error.status))) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 500 * (2 ** attempt)));
    }
  }
  throw new Error(`${label}: ${lastError?.message || 'unknown error'}`);
}

const summary = { mapped: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0), presentAndVerified: 0, presentUnverified: 0, missingOnR2: 0, uploadedAndVerified: 0, conflicts: [], errors: [] };
console.log(`${uploadRequested ? 'Upload mode' : 'Dry run'}: ${files.length} private MP3 objects (${(summary.bytes / 1024 ** 3).toFixed(2)} GiB); R2 object checks use one-byte range requests.`);

let nextIndex = 0;
const worker = async () => {
  while (nextIndex < files.length) {
    const file = files[nextIndex++];
    try {
      const localMd5 = await md5File(file.sourcePath);
      const existing = await withRetry(() => getObjectState(file), `Check ${file.entry.songId}`);
      if (existing.exists) {
        if (existing.size === file.size && existing.etag === localMd5) summary.presentAndVerified += 1;
        else {
          summary.presentUnverified += 1;
          summary.conflicts.push({ songId: file.entry.songId, localBytes: file.size, r2Bytes: existing.size, checksumMatches: existing.etag === localMd5 });
        }
        continue;
      }
      summary.missingOnR2 += 1;
      if (!uploadRequested) continue;

      await withRetry(async () => {
        // Recheck before every attempt so an interrupted PUT is resumed without overwriting an object.
        const beforePut = await getObjectState(file);
        if (beforePut.exists) {
          if (beforePut.size === file.size && beforePut.etag === localMd5) return;
          throw new Error('Object appeared with different or unverifiable content; refusing to overwrite.');
        }
        const response = await fetch(signR2Url('PUT', file.entry.objectKey, file.entry.mimeType, 900), {
          method: 'PUT',
          headers: { 'Content-Type': file.entry.mimeType },
          body: await readFile(file.sourcePath),
          signal: AbortSignal.timeout(180_000)
        });
        if (!response.ok) {
          const error = new Error(`R2 PUT returned HTTP ${response.status}.`);
          error.status = response.status;
          await response.body?.cancel();
          throw error;
        }
        await response.body?.cancel();
      }, `Upload ${file.entry.songId}`);

      const verified = await withRetry(() => getObjectState(file), `Verify ${file.entry.songId}`);
      if (!verified.exists || verified.size !== file.size || verified.etag !== localMd5) {
        throw new Error('Uploaded object failed size/checksum verification.');
      }
      summary.uploadedAndVerified += 1;
      console.log(`Verified ${summary.uploadedAndVerified} new object(s), latest: ${file.entry.songId}.`);
    } catch (error) {
      summary.errors.push({ songId: file.entry.songId, message: error.message });
    }
  }
};

await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
console.log(JSON.stringify(summary, null, 2));
if (summary.conflicts.length || summary.errors.length) process.exitCode = 1;
