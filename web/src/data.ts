import { supabase } from './supabase.ts'
import type { AppSession, Child, Device, DeviceEvent, DeviceUser, WebSession } from './types.ts'
import type { Range } from './usage.ts'

export interface DayData {
  apps: AppSession[]
  web: WebSession[]
  events: DeviceEvent[]
}

function ok<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

function check(res: { error: { message: string } | null }): void {
  if (res.error) throw new Error(res.error.message)
}

export async function fetchChildren(): Promise<Child[]> {
  return ok(await supabase.from('children').select('*').order('name'))
}

export async function fetchDevices(): Promise<Device[]> {
  return ok(await supabase.from('devices').select('*').order('name'))
}

async function fetchOverlapping<T>(table: string, deviceIds: string[], range: Range, order: string): Promise<T[]> {
  if (deviceIds.length === 0) return []
  return ok(
    await supabase
      .from(table)
      .select('*')
      .in('device_id', deviceIds)
      .lt('started_at', range.end.toISOString())
      .gt('ended_at', range.start.toISOString())
      .order(order),
  )
}

export async function fetchDay(deviceIds: string[], range: Range): Promise<DayData> {
  const [apps, web, events] = await Promise.all([
    fetchOverlapping<AppSession>('app_sessions', deviceIds, range, 'started_at'),
    fetchOverlapping<WebSession>('web_sessions', deviceIds, range, 'started_at'),
    deviceIds.length === 0
      ? Promise.resolve([] as DeviceEvent[])
      : supabase
          .from('device_events')
          .select('*')
          .in('device_id', deviceIds)
          .gte('at', range.start.toISOString())
          .lt('at', range.end.toISOString())
          .order('at')
          .then((r) => ok<DeviceEvent[]>(r)),
  ])
  return { apps, web, events }
}

/** Latest event per device (for the status dot). */
export async function fetchLastEvents(deviceIds: string[]): Promise<Map<string, DeviceEvent>> {
  const out = new Map<string, DeviceEvent>()
  for (const id of deviceIds) {
    const rows = ok<DeviceEvent[]>(
      await supabase.from('device_events').select('*').eq('device_id', id).order('at', { ascending: false }).limit(1),
    )
    if (rows[0]) out.set(id, rows[0])
  }
  return out
}

export async function createDevice(childId: string, name: string): Promise<string> {
  return ok(await supabase.rpc('create_device', { child: childId, device_name: name })) as string
}

export async function resetDeviceToken(deviceId: string): Promise<string> {
  return ok(await supabase.rpc('reset_device_token', { device: deviceId })) as string
}

export async function deleteDevice(deviceId: string): Promise<void> {
  check(await supabase.from('devices').delete().eq('id', deviceId))
}

export async function addChild(name: string, color: string): Promise<void> {
  check(await supabase.from('children').insert({ name, color }))
}

export async function renameChild(id: string, name: string): Promise<void> {
  check(await supabase.from('children').update({ name }).eq('id', id))
}

export async function deleteChild(id: string): Promise<void> {
  check(await supabase.from('children').delete().eq('id', id))
}

export async function fetchDeviceUsers(deviceId: string): Promise<DeviceUser[]> {
  return ok(await supabase.from('device_users').select('*').eq('device_id', deviceId).order('win_user'))
}

export async function setSupervised(deviceId: string, sid: string, on: boolean): Promise<void> {
  check(await supabase.from('device_users').update({ supervised: on }).eq('device_id', deviceId).eq('sid', sid))
}
