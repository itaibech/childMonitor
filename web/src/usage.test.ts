import { describe, it, expect } from 'vitest'
import { byHour, clip, dayRange, screenTimeMs, topBy } from './usage'

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
