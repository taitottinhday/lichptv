import { readdir, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

const CACHEABLE_EXTENSIONS = new Set([
  '.css', '.html', '.ico', '.jpeg', '.jpg', '.js', '.json', '.png', '.svg', '.txt', '.webmanifest'
]);
const MAX_CACHEABLE_FILE_SIZE = 1_500_000;

async function listOfflineFiles(distRoot, directory = distRoot) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const filePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listOfflineFiles(distRoot, filePath));
      continue;
    }
    if (!entry.isFile() || !CACHEABLE_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    const fileInfo = await stat(filePath);
    if (fileInfo.size > MAX_CACHEABLE_FILE_SIZE) continue;
    files.push(`/${relative(distRoot, filePath).split(sep).join('/')}`);
  }

  return files;
}

export function registerOfflineShellRoute(app, distRoot) {
  app.get('/offline-precache.json', async (_request, response) => {
    try {
      const files = await listOfflineFiles(distRoot);
      return response.set('Cache-Control', 'no-store').json({ files: [...new Set(files)] });
    } catch (error) {
      console.error('Không tạo được danh sách tài nguyên offline:', error.message);
      return response.status(503).json({ error: 'Chưa tạo được danh sách tài nguyên offline.' });
    }
  });
}
