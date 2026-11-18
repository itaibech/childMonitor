import { beforeEach, describe, expect, it, vi } from 'vitest'

const { range } = vi.hoisted(() => ({ range: vi.fn() }))

vi.mock('./supabase.ts', () => {
  const q: Record<string, unknown> = { range }
  for (const m of ['select', 'in', 'lt', 'gt', 'gte', 'order']) q[m] = () => q
  return { supabase: { from: () => q } }
})

import { fetchDay } from './data.ts'

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i) }))

describe('fetchDay pagination', () => {
  beforeEach(() => {
    range.mockReset()
  })

  it('fetches every page until a short page', async () => {
    range.mockImplementation((from: number) =>
      Promise.resolve({ data: from === 0 ? rows(1000) : rows(5), error: null }),
    )
    const day = await fetchDay(['d1'], { start: new Date(0), end: new Date(1e9) })
    expect(day.apps).toHaveLength(1005)
    expect(range).toHaveBeenCalledWith(0, 999)
    expect(range).toHaveBeenCalledWith(1000, 1999)
  })
})
