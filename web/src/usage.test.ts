import { describe, it, expect } from 'vitest'
import { addDays, byCategory, byHour, clip, dailyMs, dayFacts, dayRange, lateMs, screenTimeMs, siteCategory, topBy, weekDates } from './usage'

const MIN = 60_000
const row = (s: string, e: string, process = 'a.exe') => ({ started_at: s, ended_at: e, process })

describe('usage', () => {
  it('splits session across Jerusalem midnight', () => {
    const rows = [row('2026-11-18T21:30:00Z', '2026-11-18T22:30:00Z')]
    expect(screenTimeMs(rows, dayRange('2026-11-18'))).toBe(30 * MIN)
    expect(screenTimeMs(rows, dayRange('2026-11-19'))).toBe(30 * MIN)
  })

  it('overlapping sessions count once', () => {
    const rows = [
      row('2026-11-18T10:00:00Z', '2026-11-18T11:00:00Z'),
      row('2026-11-18T10:30:00Z', '2026-11-18T11:30:00Z'),
    ]
    expect(screenTimeMs(rows, dayRange('2026-11-18'))).toBe(90 * MIN)
  })

  it('treats ended_at before started_at as zero length', () => {
    const rows = [row('2026-11-18T11:00:00Z', '2026-11-18T10:00:00Z')]
    expect(screenTimeMs(rows, dayRange('2026-11-18'))).toBe(0)
    expect(clip(rows, dayRange('2026-11-18'))).toEqual([])
  })

  it('day ranges handle DST lengths', () => {
    const hours = (d: string) => {
      const r = dayRange(d)
      return (r.end.getTime() - r.start.getTime()) / 3_600_000
    }
    expect(hours('2026-10-25')).toBe(25)
    expect(hours('2026-03-27')).toBe(23)
    expect(hours('2026-11-18')).toBe(24)
    expect(dayRange('2026-11-18').start.toISOString()).toBe('2026-11-17T22:00:00.000Z')
  })

  it('byHour sums to screenTime and has DST-correct length', () => {
    const rows = [
      row('2026-11-18T06:15:00Z', '2026-11-18T07:45:00Z'),
      row('2026-11-18T07:00:00Z', '2026-11-18T08:10:00Z'),
      row('2026-11-18T21:30:00Z', '2026-11-18T22:30:00Z'),
    ]
    const range = dayRange('2026-11-18')
    const bars = byHour(rows, range)
    expect(bars).toHaveLength(24)
    expect(bars.reduce((a, b) => a + b, 0)).toBeCloseTo(screenTimeMs(rows, range) / MIN)
    expect(byHour([], dayRange('2026-10-25'))).toHaveLength(25)
    expect(byHour([], dayRange('2026-03-27'))).toHaveLength(23)
  })

  it('topBy groups by process', () => {
    const rows = clip(
      [
        row('2026-11-18T10:00:00Z', '2026-11-18T10:10:00Z', 'chrome.exe'),
        row('2026-11-18T11:00:00Z', '2026-11-18T11:05:00Z', 'chrome.exe'),
        row('2026-11-18T12:00:00Z', '2026-11-18T12:20:00Z', 'game.exe'),
      ],
      dayRange('2026-11-18'),
    )
    expect(topBy(rows, (r) => r.process)).toEqual([
      { key: 'game.exe', ms: 20 * MIN },
      { key: 'chrome.exe', ms: 15 * MIN },
    ])
  })
})

describe('week and insights', () => {
  it('addDays and weekDates cross month ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(weekDates('2026-11-03')).toEqual(['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'])
  })

  it('dailyMs splits per Jerusalem day', () => {
    const rows = [row('2026-11-17T21:30:00Z', '2026-11-17T22:30:00Z')]
    expect(dailyMs(rows, ['2026-11-17', '2026-11-18'])).toEqual([30 * MIN, 30 * MIN])
  })

  it('dayFacts joins short gaps into one stretch', () => {
    const rows = [
      row('2026-11-18T08:00:00Z', '2026-11-18T08:30:00Z'),
      row('2026-11-18T08:31:00Z', '2026-11-18T09:00:00Z'),
      row('2026-11-18T12:00:00Z', '2026-11-18T12:10:00Z'),
    ]
    const f = dayFacts(rows, dayRange('2026-11-18'))
    expect(f.first).toBe(Date.parse('2026-11-18T08:00:00Z'))
    expect(f.last).toBe(Date.parse('2026-11-18T12:10:00Z'))
    expect(f.longestMs).toBe(60 * MIN)
    expect(dayFacts([], dayRange('2026-11-18'))).toEqual({ first: null, last: null, longestMs: 0 })
  })

  it('lateMs counts 22:00 to 05:00 Jerusalem time after the date', () => {
    // 22:30-23:00 Jerusalem on the 18th (UTC+2) and 06:00 on the 19th, which is not late
    const rows = [row('2026-11-18T20:30:00Z', '2026-11-18T21:00:00Z'), row('2026-11-19T04:00:00Z', '2026-11-19T04:30:00Z')]
    expect(lateMs(rows, '2026-11-18')).toBe(30 * MIN)
  })

  it('byCategory uses sites for browser time and keeps unmatched browser time as Browsing', () => {
    const range = dayRange('2026-11-18')
    const apps = [
      row('2026-11-18T08:00:00Z', '2026-11-18T09:00:00Z', 'chrome.exe'),
      row('2026-11-18T09:00:00Z', '2026-11-18T09:30:00Z', 'RobloxPlayerBeta.exe'),
      row('2026-11-18T10:00:00Z', '2026-11-18T10:10:00Z', 'notepad.exe'),
    ]
    const web = [{ started_at: '2026-11-18T08:00:00Z', ended_at: '2026-11-18T08:40:00Z', domain: 'www.youtube.com' }]
    expect(byCategory(apps, web, range)).toEqual([
      { key: 'Video', ms: 40 * MIN }, { key: 'Games', ms: 30 * MIN }, { key: 'Browsing', ms: 20 * MIN }, { key: 'Other', ms: 10 * MIN },
    ])
    expect(siteCategory('classroom.google.com')).toBe('School')
    expect(siteCategory('notyoutube.com')).toBe('Browsing')
  })
})
