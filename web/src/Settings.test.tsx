import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  fetchChildren: vi.fn(),
  fetchDevices: vi.fn(),
  fetchDeviceUsers: vi.fn(),
  createDevice: vi.fn(),
  setSupervised: vi.fn(),
  resetDeviceToken: vi.fn(),
  deleteDevice: vi.fn(),
  addChild: vi.fn(),
  renameChild: vi.fn(),
  deleteChild: vi.fn(),
  setChildPhoto: vi.fn(),
  setOffline: vi.fn(),
  fetchCategories: vi.fn(),
  fetchSiteCategories: vi.fn(),
  fetchUncategorized: vi.fn(),
  addCategory: vi.fn(),
  fetchTimeLimits: vi.fn(),
}))
vi.mock('./data.ts', () => m)

import { Settings } from './Settings.tsx'

const device = { id: 'dev1', child_id: 'c1', name: 'Kitchen', created_at: '2026-11-01T00:00:00Z', last_seen_at: null, agent_version: null }

describe('Settings', () => {
  beforeEach(() => {
    m.fetchChildren.mockResolvedValue([{ id: 'c1', name: 'Noa', color: '#f00' }])
    m.fetchDevices.mockResolvedValue([device])
    m.fetchDeviceUsers.mockResolvedValue([
      { device_id: 'dev1', sid: 'S-1', win_user: 'noa', is_admin: false, supervised: true, first_seen_at: '' },
      { device_id: 'dev1', sid: 'S-2', win_user: 'itai', is_admin: true, supervised: false, first_seen_at: '' },
    ])
    m.createDevice.mockResolvedValue('tok123')
    m.setSupervised.mockResolvedValue(undefined)
    m.fetchCategories.mockResolvedValue([{ name: 'Games', color: '#f5b84b', position: 1 }])
    m.fetchSiteCategories.mockResolvedValue([])
    m.fetchUncategorized.mockResolvedValue([])
    m.addCategory.mockResolvedValue(undefined)
    m.fetchTimeLimits.mockResolvedValue([])
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('offers a photo and removes an existing one', async () => {
    render(<Settings />)
    expect(await screen.findByLabelText('Photo of Noa')).toBeTruthy()
    expect(screen.getByText('Add photo')).toBeTruthy()
    cleanup()
    m.fetchChildren.mockResolvedValue([{ id: 'c1', name: 'Noa', color: '#f00', photo: 'data:image/jpeg;base64,AAAA' }])
    m.setChildPhoto.mockResolvedValue(undefined)
    render(<Settings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove photo' }))
    await waitFor(() => expect(m.setChildPhoto).toHaveBeenCalledWith('c1', null))
  })

  it('saves offline time for a child', async () => {
    m.setOffline.mockResolvedValue(undefined)
    render(<Settings />)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Turn the internet off at night' }))
    fireEvent.change(screen.getAllByLabelText('From')[0], { target: { value: '21:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(m.setOffline).toHaveBeenCalledWith('c1', {
      enabled: true, weekday: { from: '21:00', to: '07:00' }, weekend: { from: '23:00', to: '08:00' },
    }))
  })

  it('pairs a laptop and shows the token and install command', async () => {
    render(<Settings />)
    fireEvent.change(await screen.findByLabelText('Laptop name'), { target: { value: 'Desk' } })
    fireEvent.change(screen.getByLabelText('Child'), { target: { value: 'c1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add laptop' }))
    await waitFor(() => expect(m.createDevice).toHaveBeenCalledWith('c1', 'Desk'))
    expect(await screen.findByText(/install\.ps1 -Token tok123$/)).toBeTruthy()
    expect(screen.getByText(/only once/i)).toBeTruthy()
  })

  it('tells which laptop needs a service update', async () => {
    m.fetchDevices.mockResolvedValue([{ ...device, last_seen_at: '2026-11-19T10:00:00Z', agent_version: '0.1.0' }])
    render(<Settings />)
    expect(await screen.findByText(/Service 0\.1\.0 is out of date.*install again on Kitchen/)).toBeTruthy()
  })

  it('adds a category from Settings', async () => {
    render(<Settings />)
    fireEvent.change(await screen.findByLabelText('New category name'), { target: { value: 'Art' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }))
    await waitFor(() => expect(m.addCategory).toHaveBeenCalledWith('Art', '#5b9fd0'))
  })

  it('marks admin accounts and toggles supervision', async () => {
    render(<Settings />)
    expect(await screen.findByText('admin')).toBeTruthy()
    const box = await screen.findByLabelText('Supervised noa')
    fireEvent.click(box)
    await waitFor(() => expect(m.setSupervised).toHaveBeenCalledWith('dev1', 'S-1', false))
  })
})
