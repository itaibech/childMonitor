import { supabase } from './supabase.ts'
import type { AppSession, Child, Device, DeviceEvent, DeviceUser, Offline, WebSession } from './types.ts'
import type { Range, SiteCategory } from './usage.ts'

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

const PAGE = 1000

interface PageQuery<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>
}

async function fetchAll<T>(build: () => PageQuery<T>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const page = ok(await build().range(from, from + PAGE - 1))
    out.push(...page)
    if (page.length < PAGE) return out
  }
}

async function fetchOverlapping<T>(table: string, deviceIds: string[], range: Range): Promise<T[]> {
  if (deviceIds.length === 0) return []
  return fetchAll<T>(() =>
    supabase
      .from(table)
      .select('*')
      .in('device_id', deviceIds)
      .lt('started_at', range.end.toISOString())
      .gt('ended_at', range.start.toISOString())
      .order('started_at')
      .order('id'),
  )
}

async function fetchEvents(deviceIds: string[], range: Range): Promise<DeviceEvent[]> {
  if (deviceIds.length === 0) return []
  return fetchAll<DeviceEvent>(() =>
    supabase
      .from('device_events')
      .select('*')
      .in('device_id', deviceIds)
      .gte('at', range.start.toISOString())
      .lt('at', range.end.toISOString())
      .order('at')
      .order('id'),
  )
}

export async function fetchDay(deviceIds: string[], range: Range): Promise<DayData> {
  const [apps, web, events] = await Promise.all([
    fetchOverlapping<AppSession>('app_sessions', deviceIds, range),
    fetchOverlapping<WebSession>('web_sessions', deviceIds, range),
    fetchEvents(deviceIds, range),
  ])
  return { apps, web, events }
}

/** Latest event per device (for the status dot). */
export async function fetchLastEvents(deviceIds: string[]): Promise<Map<string, DeviceEvent>> {
  const rows = await Promise.all(
    deviceIds.map(async (id) =>
      ok<DeviceEvent[]>(
        await supabase.from('device_events').select('*').eq('device_id', id).order('at', { ascending: false }).limit(1),
      )[0],
    ),
  )
  const out = new Map<string, DeviceEvent>()
  rows.forEach((e, i) => { if (e) out.set(deviceIds[i], e) })
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

export async function setChildPhoto(id: string, photo: string | null): Promise<void> {
  check(await supabase.from('children').update({ photo }).eq('id', id))
}

export async function setOffline(id: string, offline: Offline): Promise<void> {
  check(await supabase.from('children').update({ offline }).eq('id', id))
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

// Windows client zip in the private storage bucket (admin-only by RLS; see supabase/childmonitor.sql).
const CLIENT_BUCKET = 'childmonitor-client'
export const CLIENT_FILE = 'ChildMonitor.zip'

export interface ClientFile {
  size: number
  updatedAt: string
}

export async function fetchClientFile(): Promise<ClientFile | null> {
  const files = ok(await supabase.storage.from(CLIENT_BUCKET).list('', { search: CLIENT_FILE }))
  const f = files.find((o) => o.name === CLIENT_FILE)
  if (!f) return null
  return { size: Number(f.metadata?.size ?? 0), updatedAt: f.updated_at ?? f.created_at ?? '' }
}

/** Short-lived link (5 min) that downloads the zip; only the admin can create one. */
export async function clientDownloadUrl(): Promise<string> {
  return ok(await supabase.storage.from(CLIENT_BUCKET).createSignedUrl(CLIENT_FILE, 300, { download: true })).signedUrl
}

export async function uploadClient(file: Blob): Promise<void> {
  check(await supabase.storage.from(CLIENT_BUCKET).upload(CLIENT_FILE, file, { upsert: true, contentType: 'application/zip' }))
}

export interface Diagnostic {
  id: number
  created_at: string
  body: string
}

export async function fetchDiagnostics(): Promise<Diagnostic[]> {
  return ok(await supabase.from('diagnostics').select('*').order('created_at', { ascending: false }).limit(5))
}

export async function sendDiagnostics(body: string): Promise<void> {
  check(await supabase.from('diagnostics').insert({ body }))
}

export interface Category {
  name: string
  color: string
  position: number
}

export interface Unsorted {
  kind: 'site' | 'app'
  name: string
  ms: number
}

export async function fetchCategories(): Promise<Category[]> {
  return ok(await supabase.from('categories').select('*').order('position').order('name'))
}

export async function fetchSiteCategories(): Promise<SiteCategory[]> {
  return fetchAll<SiteCategory>(() => supabase.from('site_categories').select('*').order('kind').order('pattern'))
}

/** Sites and apps used in the last `days` days that match no category, most time first. */
export async function fetchUncategorized(days = 30): Promise<Unsorted[]> {
  return ok(await supabase.rpc('uncategorized', { since: new Date(Date.now() - days * 86_400_000).toISOString() })) as Unsorted[]
}

export async function addCategory(name: string, color: string): Promise<void> {
  check(await supabase.from('categories').insert({ name, color }))
}

export async function updateCategory(name: string, change: { name?: string; color?: string }): Promise<void> {
  check(await supabase.from('categories').update(change).eq('name', name))
}

/** Its sites and apps go back to "Needs a category". */
export async function deleteCategory(name: string): Promise<void> {
  check(await supabase.from('categories').delete().eq('name', name))
}

export async function setSiteCategory(kind: 'site' | 'app', pattern: string, category: string): Promise<void> {
  check(await supabase.from('site_categories').upsert({ kind, pattern: pattern.toLowerCase(), category, source: 'manual' }))
}

export async function removeSiteCategory(kind: 'site' | 'app', pattern: string): Promise<void> {
  check(await supabase.from('site_categories').delete().eq('kind', kind).eq('pattern', pattern))
}
