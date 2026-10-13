/** Pure timing helpers shared by the karaoke player and its regression tests. */
export function parseSyncedKaraokeLyrics(value) {
  const parsed = [];
  for (const rawLine of String(value || '').replace(/\r\n?/g, '\n').split('\n')) {
    const timestamps = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    const text = rawLine.replace(/\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
    if (!text || !timestamps.length) continue;
    for (const timestamp of timestamps) {
      const fraction = timestamp[3] || '';
      const seconds = Number(timestamp[1]) * 60 + Number(timestamp[2]) + (fraction ? Number(`0.${fraction}`) : 0);
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
