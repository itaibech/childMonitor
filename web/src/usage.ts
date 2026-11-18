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

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

/** HH:MM in Asia/Jerusalem. */
export function fmtTime(t: Date | string | number): string {
  return timeFmt.format(new Date(t))
}

export function todayJerusalem(now: Date = new Date()): string {
  return dateFmt.format(now)
}

/** The date if it is a real YYYY-MM-DD, else today in Jerusalem. */
export function validDate(date: string | null): string {
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split('-').map(Number)
    const check = new Date(Date.UTC(y, m - 1, d))
    if (check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d) return date
  }
  return todayJerusalem()
}

export function fmtDuration(ms: number): string {
  const min = Math.round(ms / MIN_MS)
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`
}

/** YYYY-MM-DD n days after date (n may be negative). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** The 7 dates ending on (and including) date, oldest first. */
export function weekDates(date: string): string[] {
  return [6, 5, 4, 3, 2, 1, 0].map((n) => addDays(date, -n))
}

/** From the start of the first date to the end of the last. */
export function spanRange(first: string, last: string): Range {
  return { start: dayRange(first).start, end: dayRange(last).end }
}

export function dailyMs(rows: Timed[], dates: string[]): number[] {
  return dates.map((d) => screenTimeMs(rows, dayRange(d)))
}

/** First and last use, and the longest stretch of use (gaps under 2 minutes don't break it). */
export function dayFacts(rows: Timed[], range: Range): { first: number | null; last: number | null; longestMs: number } {
  const runs: Array<[number, number]> = []
  for (const [s, e] of mergedIntervals(rows, range)) {
    const last = runs[runs.length - 1]
    if (last && s - last[1] < 2 * MIN_MS) last[1] = e
    else runs.push([s, e])
  }
  const longestMs = runs.reduce((m, [s, e]) => Math.max(m, e - s), 0)
  return { first: runs[0]?.[0] ?? null, last: runs[runs.length - 1]?.[1] ?? null, longestMs }
}

/** Use between 22:00 on date and 05:00 the next morning (Jerusalem). */
export function lateMs(rows: Timed[], date: string): number {
  const start = dayRange(date).start.getTime() + 22 * HOUR_MS
  const end = dayRange(addDays(date, 1)).start.getTime() + 5 * HOUR_MS
  return screenTimeMs(rows, { start: new Date(start), end: new Date(end) })
}

export type Category = 'Games' | 'Video' | 'Social' | 'School' | 'Browsing' | 'Other'
export const CATEGORIES: Category[] = ['Games', 'Video', 'Social', 'School', 'Browsing', 'Other']

// ponytail: small built-in lists of common apps and sites; extend as new names show up in the reports.
const APP_WORDS: Array<[RegExp, Category]> = [
  [/roblox|minecraft|steam|epicgames|fortnite|valorant|leagueoflegends|riotclient|xboxapp|gamebar|solitaire/, 'Games'],
  [/netflix|vlc|spotify|disney|primevideo|wmplayer|video\.ui|mpc-hc/, 'Video'],
  [/whatsapp|discord|telegram|instagram|tiktok|messenger|snapchat/, 'Social'],
  [/winword|excel|powerpnt|onenote|teams|zoom|acrobat|acrord32|notion|geogebra|scratch/, 'School'],
]
const SITE_WORDS: Array<[RegExp, Category]> = [
  [/(^|\.)(roblox|poki|crazygames|miniclip|chess|lichess|coolmathgames|friv|twitch)\./, 'Games'],
  [/(^|\.)(youtube|youtu|netflix|disneyplus|primevideo|vimeo|spotify|sdarot|kan)\./, 'Video'],
  [/(^|\.)(tiktok|instagram|facebook|whatsapp|discord|snapchat|reddit|x|twitter|telegram|pinterest)\./, 'Social'],
  [/(^|\.)(classroom\.google|docs\.google|drive\.google|khanacademy|wikipedia|duolingo|mashov|webtop|office|canva|geogebra|scratch\.mit|edu|gov)\./, 'School'],
]
const BROWSERS = /^(chrome|msedge|firefox|brave|opera|iexplore)\.exe$/

export function appCategory(process: string): Category {
  const p = process.toLowerCase()
  return BROWSERS.test(p) ? 'Browsing' : APP_WORDS.find(([re]) => re.test(p))?.[1] ?? 'Other'
}

export function siteCategory(domain: string): Category {
  const d = `${domain.toLowerCase()}.`
  return SITE_WORDS.find(([re]) => re.test(d))?.[1] ?? 'Browsing'
}

/** Time per category: browser time is split by the sites seen; browser time without a matched site stays Browsing. */
export function byCategory(
  apps: Array<Timed & { process: string }>, web: Array<Timed & { domain: string }>, range: Range,
): Array<{ key: Category; ms: number }> {
  const totals = new Map<Category, number>()
  const add = (c: Category, ms: number) => totals.set(c, (totals.get(c) ?? 0) + ms)
  let browserMs = 0
  for (const a of clip(apps, range)) {
    const c = appCategory(a.process)
    if (c === 'Browsing') browserMs += a.ms
    else add(c, a.ms)
  }
  const siteRows = clip(web, range)
  for (const w of siteRows) add(siteCategory(w.domain), w.ms)
  add('Browsing', Math.max(0, browserMs - siteRows.reduce((s, w) => s + w.ms, 0)))
  return [...totals].map(([key, ms]) => ({ key, ms })).filter((c) => c.ms > 0).sort((a, b) => b.ms - a.ms)
}
