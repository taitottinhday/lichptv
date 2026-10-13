import { open, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, basename } from 'node:path';
import { r2Configured, signR2Url } from '../r2-storage.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifestPath = resolve(projectRoot, 'public/audio-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const entries = Object.values(manifest.entries || {});
const uploadRequested = process.argv.includes('--upload');
const limitArgument = process.argv.find((argument) => argument.startsWith('--limit='));
const uploadLimit = limitArgument ? Number(limitArgument.slice('--limit='.length)) : Infinity;

if (!(uploadLimit > 0)) throw new Error('Upload limit must be a positive number.');
const selectedEntries = entries.slice(0, uploadLimit);

if (!r2Configured) throw new Error('R2 credentials are missing. Set them in a private .env or server environment.');
if (manifest.schemaVersion !== 1 || manifest.storage !== 'cloudflare-r2-private') throw new Error('Unsupported or non-private audio manifest.');

const files = [];
for (const entry of selectedEntries) {
  if (!entry.songId || entry.objectKey !== `audio/${entry.songId}.mp3` || entry.mimeType !== 'audio/mpeg') {
    throw new Error(`Invalid manifest entry for ${entry.songId || 'unknown song'}.`);
  }
  if (typeof entry.sourceFile !== 'string' || basename(entry.sourceFile) !== entry.sourceFile) {
    throw new Error(`Missing safe source filename for ${entry.songId}.`);
  }
  const sourcePath = resolve(projectRoot, entry.sourceFile);
  const fileInfo = await stat(sourcePath);
  const handle = await open(sourcePath, 'r');
  const header = Buffer.alloc(3);
  await handle.read(header, 0, 3, 0);
  await handle.close();
  const isMp3 = header.toString('ascii') === 'ID3';
  if (!fileInfo.isFile() || !isMp3) throw new Error(`Source is missing or is not an ID3 MP3 for ${entry.songId}.`);
  files.push({ entry, sourcePath, size: fileInfo.size });
}

const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
console.log(`${uploadRequested ? 'Uploading' : 'Dry run'}: ${files.length} private MP3 objects (${(totalBytes / 1024 ** 3).toFixed(2)} GiB) to R2.`);
if (!uploadRequested) {
  console.log('Run with --upload to send these files to the configured private bucket.');
  process.exit(0);
}

let nextIndex = 0;
let uploaded = 0;
const errors = [];
const worker = async () => {
  while (nextIndex < files.length) {
    const file = files[nextIndex++];
    try {
      const body = await readFile(file.sourcePath);
      const url = signR2Url('PUT', file.entry.objectKey, file.entry.mimeType, 900);
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': file.entry.mimeType },
        body
      });
      if (!response.ok) throw new Error(`R2 returned HTTP ${response.status}.`);
      uploaded += 1;
      if (uploaded % 10 === 0 || uploaded === files.length) console.log(`Uploaded ${uploaded}/${files.length}.`);
    } catch (error) {
      errors.push({ songId: file.entry.songId, message: error.message });
    }
  }
};

await Promise.all(Array.from({ length: Math.min(2, files.length) }, worker));
if (errors.length) {
  console.error(`Upload finished with ${errors.length} failed objects.`);
  for (const error of errors) console.error(`${error.songId}: ${error.message}`);
  process.exitCode = 1;
} else {
  console.log(`Upload complete: ${uploaded} objects stored in the private R2 bucket.`);
}
