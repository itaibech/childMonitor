import { describe, expect, it } from 'vitest'
import { deviceStatus } from './health.ts'
import type { Device, DeviceEvent } from './types.ts'

const now = new Date('2026-11-18T12:00:00Z')
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()

function device(lastSeen: string | null): Device {
  return { id: 'd', child_id: 'c', name: 'L', created_at: ago(9999), last_seen_at: lastSeen, agent_version: null }
}
function event(kind: string): DeviceEvent {
  return { id: 'e', device_id: 'd', win_user: 'u', kind, detail: null, at: ago(100) }
}

describe('deviceStatus', () => {
  it('is ok when seen 5 minutes ago', () => {
    expect(deviceStatus(device(ago(5)), undefined, now)).toBe('ok')
  })
  it('is off after a clean shutdown', () => {
    expect(deviceStatus(device(ago(120)), event('shutdown'), now)).toBe('off')
  })
  it.each(['suspend', 'logoff', 'lock'])('is off after a clean %s', (kind) => {
    expect(deviceStatus(device(ago(120)), event(kind), now)).toBe('off')
  })
  it('is silent when last event was a heartbeat', () => {
    expect(deviceStatus(device(ago(120)), event('heartbeat'), now)).toBe('silent')
  })
  it('is silent when never seen', () => {
    expect(deviceStatus(device(null), undefined, now)).toBe('silent')
  })
})
