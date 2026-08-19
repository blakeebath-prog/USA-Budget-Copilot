/** Number, currency, and date formatting shared by every chart and table. */

const COMPACT_TIERS = [
  { limit: 1e12, suffix: 'T', divisor: 1e12 },
  { limit: 1e9, suffix: 'B', divisor: 1e9 },
  { limit: 1e6, suffix: 'M', divisor: 1e6 },
  { limit: 1e3, suffix: 'K', divisor: 1e3 },
] as const;

/**
 * Money at a glance: $4.2T, -$1.8B. Federal figures span twelve orders of
 * magnitude, so a compact form is the only readable default on an axis or a
 * stat tile. `full()` is what the table and tooltip show.
 */
export function compactUsd(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);
  for (const tier of COMPACT_TIERS) {
    if (magnitude >= tier.limit) {
      const scaled = magnitude / tier.divisor;
      const digits = scaled >= 100 ? 0 : fractionDigits;
      return `${sign}$${trimZeroDecimal(scaled.toFixed(digits))}${tier.suffix}`;
    }
  }
  return `${sign}$${magnitude.toFixed(0)}`;
}

/** "$91.0B" reads as false precision next to "$1.4T"; "$91B" does not. */
function trimZeroDecimal(text: string): string {
  return text.replace(/\.0+$/, '');
}

export function fullUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

export function compactNumber(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);
  for (const tier of COMPACT_TIERS) {
    if (magnitude >= tier.limit) {
      const scaled = magnitude / tier.divisor;
      return `${sign}${trimZeroDecimal(scaled.toFixed(scaled >= 100 ? 0 : fractionDigits))}${tier.suffix}`;
    }
  }
  return `${sign}${magnitude.toLocaleString('en-US')}`;
}

export function percent(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

/** Signed share-of-change label, e.g. "+12.4% vs FY2024". */
export function signedPercent(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(fractionDigits)}%`;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** 'YYYY-MM-DD' → 'Mon YYYY', parsed as a plain date so no timezone shifts it. */
export function monthLabel(isoDate: string): string {
  const parts = isoDate.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return isoDate;
  return `${MONTHS[month - 1] ?? '?'} ${year}`;
}

export function dayLabel(isoDate: string): string {
  const parts = isoDate.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return isoDate;
  return `${MONTHS[month - 1] ?? '?'} ${day}, ${year}`;
}

export function timestampLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Which way a change points, with a dead band.
 *
 * Without the band a rounding-level wobble renders as a red upward arrow, which
 * tells the reader something moved when nothing did.
 */
export function deltaDirection(change: number, tolerance = 0.0005): 'up' | 'down' | 'flat' {
  if (!Number.isFinite(change) || Math.abs(change) <= tolerance) return 'flat';
  return change > 0 ? 'up' : 'down';
}
