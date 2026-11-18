export interface Child {
  id: string
  name: string
  color: string
}

export interface Device {
  id: string
  child_id: string | null
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
