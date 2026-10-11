import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function slugify(title) {
  return String(title)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const title = readArg('--title');
const url = readArg('--url');
const hasPermission = process.argv.includes('--license-ok');

if (!title || !url || !hasPermission) {
  console.error('Cách dùng: node scripts/import-licensed-lyrics.mjs --title "Tên bài" --url "URL-file-txt" --license-ok');
  console.error('Chỉ dùng với URL mà bạn có quyền tải và hiển thị trong app.');
  process.exit(1);
}

const response = await fetch(url);
if (!response.ok) throw new Error(`Không tải được nguồn lời bài hát: HTTP ${response.status}`);

const contentType = response.headers.get('content-type') || '';
if (contentType && !/text|json|xml/i.test(contentType)) {
  throw new Error(`Nguồn không phải văn bản thuần: ${contentType}`);
}

const lyrics = (await response.text()).trim();
if (!lyrics) throw new Error('File lời bài hát đang rỗng.');

const outputDir = join(process.cwd(), 'public', 'lyrics');
const outputPath = join(outputDir, `${slugify(title)}.txt`);
await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${lyrics}\n`, 'utf8');
console.log(`Đã lưu lời bài hát vào ${basename(outputPath)}`);
