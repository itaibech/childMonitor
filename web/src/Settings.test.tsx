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
}))
vi.mock('./data.ts', () => m)
const ids = vi.hoisted(() => ({ CHROME_EXT_ID: '', EDGE_EXT_ID: '' }))
vi.mock('./extensionIds.ts', () => ids)

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
  })
  afterEach(() => {
    ids.CHROME_EXT_ID = ''
    ids.EDGE_EXT_ID = ''
    cleanup()
    vi.clearAllMocks()
  })

  it('pairs a laptop and shows the token and install command', async () => {
    render(<Settings />)
    fireEvent.change(await screen.findByLabelText('Laptop name'), { target: { value: 'Desk' } })
    fireEvent.change(screen.getByLabelText('Child'), { target: { value: 'c1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add laptop' }))
    await waitFor(() => expect(m.createDevice).toHaveBeenCalledWith('c1', 'Desk'))
    expect(await screen.findByText(/install\.ps1 -Token tok123 -ChromeExtId <CHROME_EXT_ID> -EdgeExtId <EDGE_EXT_ID>$/)).toBeTruthy()
    expect(screen.getByText(/only once/i)).toBeTruthy()
    expect(screen.getByText('Extension IDs not set yet — web tracking won\'t install')).toBeTruthy()
  })

  it('fills the extension IDs into the install command once set', async () => {
    ids.CHROME_EXT_ID = 'a'.repeat(32)
    ids.EDGE_EXT_ID = 'b'.repeat(32)
    render(<Settings />)
    fireEvent.change(await screen.findByLabelText('Laptop name'), { target: { value: 'Desk' } })
    fireEvent.change(screen.getByLabelText('Child'), { target: { value: 'c1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add laptop' }))
    const cmd = `install.ps1 -Token tok123 -ChromeExtId ${'a'.repeat(32)} -EdgeExtId ${'b'.repeat(32)}`
    expect(await screen.findByText(new RegExp(cmd))).toBeTruthy()
    expect(screen.queryByText(/Extension IDs not set yet/)).toBeNull()
  })

  it('marks admin accounts and toggles supervision', async () => {
    render(<Settings />)
    expect(await screen.findByText('admin')).toBeTruthy()
    const box = await screen.findByLabelText('Supervised noa')
    fireEvent.click(box)
    await waitFor(() => expect(m.setSupervised).toHaveBeenCalledWith('dev1', 'S-1', false))
  })
})
