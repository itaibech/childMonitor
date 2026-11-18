import { describe, expect, it } from 'vitest'
import { deviceStatus, summarizeReport } from './health.ts'
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

describe('summarizeReport', () => {
  const good = [
    '== Service', 'Status    : Running', '== Helper', '13688  1 PC\\Emma 11/18/2026', '== Build date', 'x',
    '== Server check (answer only, never the code)', '{"ok":true,"accepted":0}',
    '== Smart App Control (0 off, 1 on, 2 evaluation)', '0', '== Network', 'TcpTestSucceeded : True',
  ].join('\n')
  it('marks a healthy laptop all green', () => {
    expect(summarizeReport(good).map((c) => c.ok)).toEqual([true, true, true, true, true])
  })
  it('flags an invalid code, Smart App Control and a stopped service', () => {
    const bad = good.replace('Running', 'Stopped').replace('{"ok":true,"accepted":0}', 'failed: invalid token').replace(/\n0\n/, '\n1\n')
    const byLabel = Object.fromEntries(summarizeReport(bad).map((c) => [c.label, c.ok]))
    expect(byLabel).toMatchObject({ 'Service running': false, 'Install code accepted': false, 'Smart App Control off': false })
  })
  it('leaves checks unknown when an older report lacks the section', () => {
    expect(summarizeReport('== Service\nStatus : Running').find((c) => c.label === 'Install code accepted')?.ok).toBeNull()
  })
})
