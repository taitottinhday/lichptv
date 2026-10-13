/** Pure timing helpers shared by the karaoke player and its regression tests. */
export function parseSyncedKaraokeLyrics(value) {
  const parsed = [];
  const rawLines = String(value || '').replace(/\r\n?/g, '\n').split('\n');
  const offsetLine = rawLines.find((line) => /^\s*\[offset\s*:\s*[+-]?\d+\s*\]\s*$/i.test(line));
  const offsetMatch = offsetLine?.match(/\[offset\s*:\s*([+-]?\d+)\s*\]/i);
  const offsetSeconds = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;
  for (const rawLine of rawLines) {
    const timestamps = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    const text = rawLine.replace(/\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
    if (!text || !timestamps.length) continue;
    for (const timestamp of timestamps) {
      const fraction = timestamp[3] || '';
      const seconds = Math.max(0, Number(timestamp[1]) * 60 + Number(timestamp[2]) + (fraction ? Number(`0.${fraction}`) : 0) + offsetSeconds);
      if (Number.isFinite(seconds)) parsed.push({ seconds, text });
    }
  }
  return parsed.length >= 2 ? parsed.sort((a, b) => a.seconds - b.seconds) : [];
}

export function activeLyricIndex(lines, currentTimeSeconds) {
  if (!Array.isArray(lines) || !Number.isFinite(currentTimeSeconds)) return -1;
  let activeIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (!Number.isFinite(lines[index]?.seconds) || lines[index].seconds > currentTimeSeconds) break;
    activeIndex = index;
  }
  return activeIndex;
}

export function karaokeLyricsTextSimilarity(left, right) {
  const tokenize = (value) => String(value || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLocaleLowerCase('vi-VN')
    .match(/[\p{L}\p{N}]+/gu) || [];
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (!leftTokens.length || !rightTokens.length) return 0;
  if (leftTokens.length > 3000 || rightTokens.length > 3000) return 0;
  const widthTokens = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
  const heightTokens = leftTokens.length <= rightTokens.length ? rightTokens : leftTokens;
  let previous = new Uint32Array(widthTokens.length + 1);
  let current = new Uint32Array(widthTokens.length + 1);
  for (const token of heightTokens) {
    for (let index = 1; index <= widthTokens.length; index += 1) {
      current[index] = token === widthTokens[index - 1]
        ? previous[index - 1] + 1
        : Math.max(previous[index], current[index - 1]);
    }
    [previous, current] = [current, previous];
    current.fill(0);
  }
  return previous[widthTokens.length] / Math.max(leftTokens.length, rightTokens.length);
}

export function wordPlaybackState(word, currentTimeMs) {
  const startMs = Number(word?.startMs);
  const endMs = Number(word?.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || !Number.isFinite(currentTimeMs)) {
    return { state: 'upcoming', progress: 0 };
  }
  if (currentTimeMs >= endMs) return { state: 'sung', progress: 1 };
  if (currentTimeMs < startMs) return { state: 'upcoming', progress: 0 };
  return {
    state: 'current',
    progress: Math.min(1, Math.max(0, (currentTimeMs - startMs) / (endMs - startMs)))
  };
}
