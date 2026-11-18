import type { Device, DeviceEvent } from './types.ts'

export type DeviceStatus = 'ok' | 'off' | 'silent'

const SILENT_AFTER_MS = 30 * 60_000
const CLEAN_STOPS = new Set(['shutdown', 'suspend', 'logoff', 'lock'])

export function deviceStatus(d: Device, lastEvent: DeviceEvent | undefined, now: Date): DeviceStatus {
  if (!d.last_seen_at) return 'silent'
  if (now.getTime() - Date.parse(d.last_seen_at) <= SILENT_AFTER_MS) return 'ok'
  return lastEvent && CLEAN_STOPS.has(lastEvent.kind) ? 'off' : 'silent'
}
