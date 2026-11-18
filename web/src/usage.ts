const TZ = 'Asia/Jerusalem'
const HOUR_MS = 3_600_000
const MIN_MS = 60_000

export interface Range {
  start: Date
  end: Date
}

interface Timed {
  started_at: string
  ended_at: string
}

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
})

/** Jerusalem UTC offset (ms) at the given instant. */
function offsetMs(t: number): number {
  const p: Record<string, number> = {}
  for (const part of fmt.formatToParts(new Date(t))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value)
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(t / 1000) * 1000
}

/** UTC instant of Jerusalem local midnight for a Y-M-D. */
function localMidnight(y: number, m: number, d: number): number {
  const wall = Date.UTC(y, m - 1, d)
  let t = wall - offsetMs(wall)
  t = wall - offsetMs(t)
  return t
}

export function dayRange(date: string): Range {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  const start = localMidnight(y, m, d)
  const end = localMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())
  return { start: new Date(start), end: new Date(end) }
}

function clipInterval(r: Timed, range: Range): [number, number] | null {
  const s = Math.max(Date.parse(r.started_at), range.start.getTime())
  const e = Math.min(Date.parse(r.ended_at), range.end.getTime())
  return e > s ? [s, e] : null
}

export function clip<T extends Timed>(rows: T[], range: Range): Array<T & { ms: number }> {
  const out: Array<T & { ms: number }> = []
  for (const r of rows) {
    const iv = clipInterval(r, range)
    if (iv) out.push({ ...r, ms: iv[1] - iv[0] })
  }
  return out
}

function mergedIntervals(rows: Timed[], range: Range): Array<[number, number]> {
  const ivs = rows
    .map((r) => clipInterval(r, range))
    .filter((iv): iv is [number, number] => iv !== null)
    .sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [s, e] of ivs) {
    const last = merged[merged.length - 1]
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else merged.push([s, e])
  }
  return merged
}

export function screenTimeMs(rows: Timed[], range: Range): number {
  return mergedIntervals(rows, range).reduce((sum, [s, e]) => sum + (e - s), 0)
}

/** Minutes of (union) activity per hour bucket of the day. */
export function byHour(rows: Timed[], range: Range): number[] {
  const startMs = range.start.getTime()
  const count = Math.round((range.end.getTime() - startMs) / HOUR_MS)
  const bars = new Array<number>(count).fill(0)
  for (const [s, e] of mergedIntervals(rows, range)) {
    for (let h = Math.floor((s - startMs) / HOUR_MS); h < count; h++) {
      const hs = startMs + h * HOUR_MS
      if (hs >= e) break
      bars[h] += (Math.min(e, hs + HOUR_MS) - Math.max(s, hs)) / MIN_MS
    }
  }
  return bars
}

export function topBy<T>(
  rows: Array<T & { ms: number }>,
  key: (r: T) => string,
): Array<{ key: string; ms: number }> {
  const totals = new Map<string, number>()
  for (const r of rows) totals.set(key(r), (totals.get(key(r)) ?? 0) + r.ms)
  return [...totals.entries()].map(([k, ms]) => ({ key: k, ms })).sort((a, b) => b.ms - a.ms)
}
