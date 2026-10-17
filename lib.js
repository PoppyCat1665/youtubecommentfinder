/**
 * Pure helpers shared by the browser app and the Node test suite.
 * No DOM or network access lives in this file.
 */

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'music.youtube.com',
]);

/** Turn a YouTube URL (or a bare 11-character ID) into a video ID. */
export function parseVideoId(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  if (VIDEO_ID_RE.test(raw)) return raw;

  let url;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/^m\./, '');
  if (!YOUTUBE_HOSTS.has(host)) return null;

  let id = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/').filter(Boolean)[0] ?? null;
  } else {
    id = url.searchParams.get('v');
    if (!id) {
      const parts = url.pathname.split('/').filter(Boolean);
      if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) {
        id = parts[1] ?? null;
      }
    }
  }

  return id && VIDEO_ID_RE.test(id) ? id : null;
}

/**
 * Work out what the "channel" field points at.
 * @returns {{type: 'handle'|'id'|'username'|'search', value: string}|null}
 */
export function extractChannelRef(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;

  if (/^@[\w.-]+$/.test(raw)) return { type: 'handle', value: raw };
  if (CHANNEL_ID_RE.test(raw)) return { type: 'id', value: raw };

  let url;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return { type: 'search', value: raw };
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  if (host === 'youtube.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    const decode = (value) => {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    };

    if (parts[0] === 'channel' && parts[1]) {
      return { type: 'id', value: parts[1] };
    }
    if (parts[0]?.startsWith('@')) {
      return { type: 'handle', value: parts[0] };
    }
    if (parts[0] === 'user' && parts[1]) {
      return { type: 'username', value: decode(parts[1]) };
    }
    if (parts[0] === 'c' && parts[1]) {
      return { type: 'search', value: decode(parts[1]) };
    }
  }

  return { type: 'search', value: raw };
}

/** Drop a leading @ so "@someone" and "someone" behave the same. */
export function normalizeAuthorFilter(value) {
  return String(value ?? '').trim().replace(/^@+/, '');
}

/**
 * Test a comment against the current filters.
 * `comment.author` is a haystack that may include display name, handle URL and channel ID.
 */
export function matchesComment(comment, filters = {}) {
  const text = String(comment?.text ?? '');
  const authorHaystack = String(comment?.author ?? '');
  const needle = String(filters.phrase ?? '').trim();
  const author = normalizeAuthorFilter(filters.author);
  const matchCase = Boolean(filters.matchCase);

  const norm = (value) => (matchCase ? value : value.toLocaleLowerCase());
  const haystack = norm(text);
  const authorText = norm(authorHaystack);

  if (needle && !haystack.includes(norm(needle))) return false;
  if (author && !authorText.includes(norm(author))) return false;
  return true;
}

/**
 * Split text into plain/matched chunks so the UI can build <mark> nodes
 * without ever injecting raw HTML.
 * @returns {{text: string, match: boolean}[]}
 */
export function highlightParts(text, phrase, matchCase = false) {
  const source = String(text ?? '');
  const needle = String(phrase ?? '').trim();
  if (!needle) return [{ text: source, match: false }];

  const haystack = matchCase ? source : source.toLocaleLowerCase();
  const normalizedNeedle = matchCase ? needle : needle.toLocaleLowerCase();
  const parts = [];
  let cursor = 0;
  let found = haystack.indexOf(normalizedNeedle, cursor);

  if (found === -1) return [{ text: source, match: false }];

  while (found !== -1) {
    if (found > cursor) {
      parts.push({ text: source.slice(cursor, found), match: false });
    }
    parts.push({
      text: source.slice(found, found + needle.length),
      match: true,
    });
    cursor = found + needle.length;
    found = haystack.indexOf(normalizedNeedle, cursor);
  }

  if (cursor < source.length) {
    parts.push({ text: source.slice(cursor), match: false });
  }
  return parts;
}

/** Compact display for counts: 999 -> "999", 1200 -> "1.2K". */
export function formatCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  if (Math.abs(number) < 1000) return String(Math.trunc(number));
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(number);
}

/** Exact display with grouping: 1234567 -> "1,234,567". */
export function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('en').format(number);
}

/** "3 minutes ago", "in 2 days", ... */
export function formatRelativeTime(iso, now = Date.now()) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';

  const units = [
    ['year', 365 * 24 * 60 * 60 * 1000],
    ['month', 30 * 24 * 60 * 60 * 1000],
    ['week', 7 * 24 * 60 * 60 * 1000],
    ['day', 24 * 60 * 60 * 1000],
    ['hour', 60 * 60 * 1000],
    ['minute', 60 * 1000],
    ['second', 1000],
  ];
  const diff = then - now;
  const absolute = Math.abs(diff);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  for (const [unit, milliseconds] of units) {
    if (absolute >= milliseconds || unit === 'second') {
      return formatter.format(Math.round(diff / milliseconds), unit);
    }
  }
  return '';
}

/** ISO-8601 duration (PT1H2M3S) -> "1:02:03". */
export function formatDuration(iso) {
  if (typeof iso !== 'string') return '';
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso);
  if (!match) return '';

  const hours = Number(match[1] ?? 0) * 24 + Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Math.floor(Number(match[4] ?? 0));
  const pad = (value) => String(value).padStart(2, '0');

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/** Deep link that opens the video with the comment highlighted. */
export function commentLink(videoId, commentId) {
  const video = String(videoId ?? '').trim();
  const comment = String(commentId ?? '').trim();
  if (!video) return '';
  const base = `https://www.youtube.com/watch?v=${encodeURIComponent(video)}`;
  return comment ? `${base}&lc=${encodeURIComponent(comment)}` : base;
}

/** Escape one CSV cell (RFC 4180 style). */
export function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Build CSV text from a two-dimensional array. */
export function toCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
}
