import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  fetchTimeLimits: vi.fn(),
  fetchCategories: vi.fn(),
  fetchSiteCategories: vi.fn(),
  addTimeLimit: vi.fn(),
  setLimitMinutes: vi.fn(),
  removeTimeLimit: vi.fn(),
  extendLimit: vi.fn(),
}))
vi.mock('./data.ts', () => m)

import { LimitsSection, TodayLimits } from './Limits.tsx'

const kid = { id: 'c1', name: 'Noa', color: '#f00', photo: null, offline: null }
const roblox = { id: 'l1', child_id: 'c1', app: 'robloxplayerbeta.exe', category: null, minutes: 120, extra_minutes: 30, extra_on: '2026-11-20' }

describe('time limits', () => {
  beforeEach(() => {
    m.fetchTimeLimits.mockResolvedValue([roblox])
    m.fetchCategories.mockResolvedValue([{ name: 'Games', color: '#f5b84b', position: 1 }])
    m.fetchSiteCategories.mockResolvedValue([{ kind: 'app', pattern: 'minecraft.exe', category: 'Games', source: 'auto' }])
    for (const f of [m.addTimeLimit, m.setLimitMinutes, m.removeTimeLimit, m.extendLimit]) f.mockResolvedValue(undefined)
  })
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it('adds a category limit and changes an app limit', async () => {
    render(<LimitsSection children={[kid]} />)
    fireEvent.change(await screen.findByLabelText('Daily time for robloxplayerbeta.exe'), { target: { value: '60' } })
    await waitFor(() => expect(m.setLimitMinutes).toHaveBeenCalledWith('l1', 60))
    fireEvent.change(screen.getByLabelText('Limit for Noa on'), { target: { value: 'Games' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add limit' }))
    await waitFor(() => expect(m.addTimeLimit).toHaveBeenCalledWith('c1', { category: 'Games' }, 120))
  })

  it('adds an app limit only for an exe name', async () => {
    render(<LimitsSection children={[kid]} />)
    fireEvent.change(await screen.findByLabelText('Limit for Noa on'), { target: { value: 'app' } })
    fireEvent.change(screen.getByLabelText('App'), { target: { value: 'Minecraft.EXE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add limit' }))
    await waitFor(() => expect(m.addTimeLimit).toHaveBeenCalledWith('c1', { app: 'minecraft.exe' }, 120))
  })

  it("shows today's use as blocked and gives or takes back extra time", async () => {
    const onChange = vi.fn()
    render(<TodayLimits limits={[roblox]} today="2026-11-20" used={() => 150 * 60_000} onChange={onChange} />)
    expect(screen.getByText(/2h 30m of 2h 30m \(30m extra\) · Blocked/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '+15m' }))
    await waitFor(() => expect(m.extendLimit).toHaveBeenCalledWith('l1', 15))
    fireEvent.click(screen.getByRole('button', { name: 'Undo extra' }))
    await waitFor(() => expect(m.extendLimit).toHaveBeenCalledWith('l1', -30))
    expect(onChange).toHaveBeenCalled()
  })
})
