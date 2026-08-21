/**
 * Tolerant field access for government feeds.
 *
 * The Treasury and USAspending payloads are stable in shape but their column
 * names have shifted across dataset revisions, and a hard-coded field name that
 * silently reads `undefined` turns into a chart full of zeros — the worst
 * possible failure for a tool whose whole job is being trustworthy. Every read
 * goes through here: it takes an ordered list of candidate names, returns the
 * first one actually present, and throws a diagnostic naming the row's real
 * columns when none match.
 */
export class SchemaMismatchError extends Error {
  constructor(
    message: string,
    readonly candidates: readonly string[],
    readonly availableFields: readonly string[],
  ) {
    super(message);
    this.name = 'SchemaMismatchError';
  }
}

export type Row = Record<string, unknown>;

export function findField(row: Row, candidates: readonly string[]): string | undefined {
  return candidates.find((candidate) => row[candidate] !== undefined);
}

export function requireField(row: Row, candidates: readonly string[], context: string): string {
  const found = findField(row, candidates);
  if (found) return found;
  throw new SchemaMismatchError(
    `${context}: none of [${candidates.join(', ')}] are present. The feed returned [${Object.keys(row)
      .slice(0, 40)
      .join(', ')}].`,
    candidates,
    Object.keys(row),
  );
}

/**
 * Treasury returns every amount as a string, sometimes with commas, and uses
 * 'null' and '(*)' as in-band markers for "not reported" and "rounds to zero".
 */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value !== 'string') return Number.NaN;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'null' || trimmed === '(*)' || trimmed === '-') return Number.NaN;
  const normalized = trimmed.replace(/,/g, '').replace(/^\((.*)\)$/, '-$1');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function readNumber(row: Row, candidates: readonly string[], context: string): number {
  return toNumber(row[requireField(row, candidates, context)]);
}

export function readString(row: Row, candidates: readonly string[], context: string): string {
  const value = row[requireField(row, candidates, context)];
  return value === null || value === undefined ? '' : String(value);
}

/**
 * The first candidate that parses to a finite number.
 *
 * Distinct from `readNumber`, which takes the first field merely *present*.
 * These feeds publish every column on every row and fill the inapplicable ones
 * with the string "null" — a detail line carries a gross amount but a null net
 * amount, while its total line carries both. Taking the first present field
 * would read the null and drop the row. Falling through to the first field with
 * an actual value is what "net if reported, otherwise gross" requires.
 */
export function readFirstFiniteNumber(
  row: Row,
  candidates: readonly string[],
  context: string,
): number {
  let sawCandidate = false;
  for (const candidate of candidates) {
    if (row[candidate] === undefined) continue;
    sawCandidate = true;
    const parsed = toNumber(row[candidate]);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (sawCandidate) return Number.NaN;
  throw new SchemaMismatchError(
    `${context}: none of [${candidates.join(', ')}] are present. The feed returned [${Object.keys(row)
      .slice(0, 40)
      .join(', ')}].`,
    candidates,
    Object.keys(row),
  );
}
