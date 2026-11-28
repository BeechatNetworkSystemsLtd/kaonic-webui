/** Formatting helpers. Pure functions, no locale surprises: the UI is English-only for now. */

const RATE_UNITS = ['bit/s', 'kbit/s', 'Mbit/s', 'Gbit/s'] as const;

/** 1530 → "1.5 kbit/s". */
export function formatRate(bitsPerSecond: number): string {
  let value = Math.max(0, bitsPerSecond);
  let unit = 0;
  while (value >= 1000 && unit < RATE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${RATE_UNITS[unit]}`;
}

/** 869535000 → "869.535 MHz". */
export function formatFrequency(hz: number): string {
  return `${(hz / 1_000_000).toFixed(3)} MHz`;
}

/** 2310 → "2.3 GB", 142 → "142 MB". */
export function formatMegabytes(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/** 812 → "812 B", 48_200 → "47 KB", 3_500_000 → "3.3 MB": a file's size. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** 93784 → "1d 2h", 3700 → "1h 1m", 59 → "59s". */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/** "5 min ago", for a Unix-seconds timestamp. */
export function formatAgo(timestampSecs: number, nowMs: number = Date.now()): string {
  const elapsed = Math.max(0, Math.floor(nowMs / 1000) - timestampSecs);
  if (elapsed < 60) return 'just now';
  return `${formatDuration(elapsed)} ago`;
}

/** When a node was last heard, for an out-of-range one: a known node may never have been. */
export function seenText(lastSeenTs: number, prefix = 'Seen'): string {
  return lastSeenTs > 0 ? `${prefix} ${formatAgo(lastSeenTs)}` : 'Not heard yet';
}

/** "a41f..6e30": the first and last four characters, enough of a hash to recognise it. */
export function shortHash(hash: string): string {
  return hash.length > 10 ? `${hash.slice(0, 4)}..${hash.slice(-4)}` : hash;
}

/** 812 → "812", 14_100 → "14.1k", 2_950_000 → "2.95M": a count that fits a narrow column. */
export function formatCount(count: number): string {
  if (count < 10_000) return String(Math.round(count));
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 100_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 2 : 1)}M`;
}

/** Unix milliseconds → "14:03:52.123", local time: when a frame went by. */
export function formatClock(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}
