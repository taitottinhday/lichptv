/** Pure timing helpers shared by the karaoke player and its regression tests. */
export function parseSyncedKaraokeLyrics(value) {
  const parsed = [];
  const rawLines = String(value || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const offsetLine = rawLines.find((line) => /^\s*\[offset\s*:\s*[+-]?\d+\s*\]\s*$/i.test(line));
  const offsetMatch = offsetLine?.match(/\[offset\s*:\s*([+-]?\d+)\s*\]/i);
  const offsetSeconds = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;
  for (const rawLine of rawLines) {
    const timestamps = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    const text = rawLine.replace(/\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
    if (!text || !timestamps.length) continue;
    for (const timestamp of timestamps) {
      const fraction = timestamp[3] || '';
      const minutes = Number(timestamp[1]);
      const wholeSeconds = Number(timestamp[2]);
      if (wholeSeconds > 59) continue;
      const seconds = minutes * 60 + wholeSeconds + (fraction ? Number(`0.${fraction}`) : 0) + offsetSeconds;
      if (Number.isFinite(seconds)) parsed.push({ seconds: Math.max(0, seconds), text });
    }
  }
  parsed.sort((a, b) => a.seconds - b.seconds);
  // Repeated tags with the same text and time can otherwise create zero-length
  // rows that disappear from the karaoke timeline.
  const unique = parsed.filter((line, index) => index === 0
    || line.seconds !== parsed[index - 1].seconds
    || line.text !== parsed[index - 1].text);
  return unique.length >= 2 ? unique : [];
}

export function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function getLineProgress(time, start, end) {
  if (![time, start, end].every(Number.isFinite) || start < 0 || end <= start) return 0;
  return clamp01((time - start) / (end - start));
}

export function getLineState(time, line) {
  const start = Number(line?.start);
  const end = Number(line?.end);
  if (!Number.isFinite(time) || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return 'upcoming';
  if (time < start) return 'upcoming';
  if (time >= end) return 'done';
  return 'active';
}

/** Normalize known seconds fields only. Milliseconds are converted only for explicit *Ms fields. */
export function normalizeTimedLyrics(input, { warn = false } = {}) {
  if (!Array.isArray(input)) return [];
  const result = [];
  input.forEach((line, index) => {
    const text = typeof line?.text === 'string' ? line.text.trim() : '';
    let start = Number(line?.start ?? line?.timeStart ?? line?.seconds ?? line?.timestamp);
    let end = Number(line?.end ?? line?.timeEnd);
    if (line?.startMs != null && line?.start === undefined && line?.timeStart === undefined && line?.seconds === undefined) start = Number(line.startMs) / 1000;
    if (line?.endMs != null && line?.end === undefined && line?.timeEnd === undefined) end = Number(line.endMs) / 1000;
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      if (warn && typeof console !== 'undefined') console.warn(`Bỏ qua dòng lyrics có timing không hợp lệ (index ${index}).`);
      return;
    }
    result.push({ id: String(line.id || `lyric-${index}-${start}`), sourceIndex: index, text, start, end });
  });
  return result.sort((left, right) => left.start - right.start || left.end - right.end);
}

/** LRC supplies starts only; the next start gives an approximate end, and a known track duration can close the final interval. */
export function lrcLineIntervals(lines, durationSeconds = null) {
  if (!Array.isArray(lines)) return [];
  const duration = durationSeconds == null ? Number.NaN : Number(durationSeconds);
  return lines.map((line, index) => {
    const nextStart = lines[index + 1]?.seconds ?? Number.NaN;
    const rawEnd = Number.isFinite(nextStart) ? nextStart : duration;
    return {
      id: `lrc-${index}-${line.seconds}`,
      sourceIndex: index,
      text: line.text,
      start: line.seconds,
      end: Number.isFinite(duration) ? Math.min(rawEnd, duration) : rawEnd
    };
  }).filter((line) => line.text?.trim() && Number.isFinite(line.start) && Number.isFinite(line.end)
    && line.start >= 0 && (!Number.isFinite(duration) || line.start < duration) && line.end > line.start);
}

/** Keep LRC timestamps anchored to the recording; duration variance only closes the final interval. */
export function fitTimedLyricIntervalsToAudio(lines, sourceDurationSeconds, audioDurationSeconds) {
  if (!Array.isArray(lines)) return [];
  const audioDuration = Number(audioDurationSeconds);
  if (!Number.isFinite(audioDuration) || audioDuration <= 0) return lines;
  return lines.map((line) => ({
    ...line,
    end: Math.min(Number(line.end), audioDuration)
  })).filter((line) => Number.isFinite(line.start) && Number.isFinite(line.end)
    && line.start >= 0 && line.start < audioDuration && line.end > line.start);
}

/** Create explicitly approximate row intervals for lyrics that have no timestamps. */
export function estimateLyricLineIntervals(lines, durationSeconds) {
  const duration = Number(durationSeconds);
  if (!Array.isArray(lines) || !Number.isFinite(duration) || duration < 10) return [];
  const eligible = lines.map((value, sourceIndex) => ({
    sourceIndex,
    text: String(value || '').trim()
  })).filter(({ text }) => text && !/^\[(verse|chorus|pre-chorus|bridge|điệp khúc|đoạn)\s*[^\]]*\]$/i.test(text));
  if (!eligible.length) return [];

  const introOffset = Math.min(6, duration * 0.04);
  const endOffset = Math.min(5, duration * 0.03);
  const availableDuration = duration - introOffset - endOffset;
  if (availableDuration <= 0) return [];
  const weights = eligible.map(({ text }) => Math.max(1, (text.match(/[\p{L}\p{N}]+/gu) || []).length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let elapsedWeight = 0;
  return eligible.map((line, index) => {
    const start = introOffset + availableDuration * elapsedWeight / totalWeight;
    elapsedWeight += weights[index];
    const end = introOffset + availableDuration * elapsedWeight / totalWeight;
    return { id: `estimate-${line.sourceIndex}-${start.toFixed(3)}`, sourceIndex: line.sourceIndex, text: line.text, start, end };
  });
}

/** Latest-starting line wins if verified intervals overlap; gaps return -1. */
export function activeTimedLyricIndex(lines, time) {
  if (!Array.isArray(lines) || !Number.isFinite(time)) return -1;
  let active = -1;
  let latestStart = -Infinity;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (getLineState(time, line) === 'active' && line.start >= latestStart) {
      latestStart = line.start;
      active = index;
    }
  }
  return active;
}

/** Require a matched provider recording and a close duration match with this song's active audio. */
export function timingMatchesAudio({ songId, source, providerTrackId, durationSeconds, audioSongId, audioSrc, audioDuration }) {
  const lyricsDuration = Number(durationSeconds);
  const trustedTimedSource = source === 'lrclib' || source === 'zing-lrc';
  return Boolean(songId && audioSongId === songId && audioSrc && trustedTimedSource && providerTrackId
    && Number.isFinite(audioDuration) && audioDuration > 0 && Number.isFinite(lyricsDuration) && lyricsDuration > 0
    // Provider and manifest durations are often rounded differently. A small fixed
    // allowance avoids rejecting otherwise verified LRC solely at the threshold.
    && Math.abs(audioDuration - lyricsDuration) <= Math.max(2, audioDuration * 0.005));
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

/** A timed lyric source is unsafe to use when it cannot be checked against known lyrics. */
export function syncedLyricsMatchReference(referenceLyrics, candidateLyrics) {
  const reference = String(referenceLyrics || '').trim();
  const candidate = String(candidateLyrics || '').trim();
  return Boolean(reference && candidate && karaokeLyricsTextSimilarity(reference, candidate) >= 0.9);
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
