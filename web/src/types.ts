export interface Child {
  id: string
  name: string
  color: string | null
  photo: string | null // small square JPEG as a data URL
  offline: Offline | null
}

/** Nightly offline time; a night belongs to the day it starts on, Friday and Saturday nights use `weekend`. */
export interface Offline {
  enabled: boolean
  weekday: { from: string; to: string }
  weekend: { from: string; to: string }
}

/** Daily limit on one app (lowercase exe) or a category; extra_minutes counts only on extra_on (today's extension). */
export interface TimeLimit {
  id: string
  child_id: string
  app: string | null
  category: string | null
  minutes: number
  extra_minutes: number
  extra_on: string | null
}

export interface Device {
  id: string
  child_id: string
  name: string
  created_at: string
  last_seen_at: string | null
  agent_version: string | null
}

export interface AppSession {
  id: string
  device_id: string
  win_user: string
  process: string
  title: string
  started_at: string
  ended_at: string
}

export interface WebSession {
  id: string
  device_id: string
  win_user: string
  browser: string
  url: string
  domain: string
  title: string
  started_at: string
  ended_at: string
}

export interface DeviceEvent {
  id: string
  device_id: string
  win_user: string
  kind: string
  detail: Record<string, unknown> | null
  at: string
}

export interface DeviceUser {
  device_id: string
  sid: string
  win_user: string
  is_admin: boolean
  supervised: boolean
  first_seen_at: string
}
