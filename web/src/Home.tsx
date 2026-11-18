import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import { fetchChildren, fetchDay, fetchDevices, fetchLastEvents } from './data.ts'
import type { DayData } from './data.ts'
import { deviceStatus } from './health.ts'
import type { DeviceStatus } from './health.ts'
import type { Child, Device, DeviceEvent } from './types.ts'
import { clip, dayRange, fmtDuration, fmtTime, screenTimeMs, todayJerusalem, topBy } from './usage.ts'

interface HomeData {
  children: Child[]
  devices: Device[]
  day: DayData
  last: Map<string, DeviceEvent>
}

async function load(): Promise<HomeData> {
  const [children, devices] = await Promise.all([fetchChildren(), fetchDevices()])
  const ids = devices.map((d) => d.id)
  const [day, last] = await Promise.all([fetchDay(ids, dayRange(todayJerusalem())), fetchLastEvents(ids)])
  return { children, devices, day, last }
}

function childStatus(devs: Device[], last: Map<string, DeviceEvent>): DeviceStatus | 'none' {
  if (devs.length === 0) return 'none'
  const all = devs.map((d) => deviceStatus(d, last.get(d.id), new Date()))
  if (all.includes('silent')) return 'silent'
  return all.includes('ok') ? 'ok' : 'off'
}

function lastSeen(devs: Device[]): string {
  const seen = devs.map((d) => d.last_seen_at).filter((s): s is string => s !== null).sort()
  const latest = seen[seen.length - 1]
  if (!latest) return 'never'
  const date = todayJerusalem(new Date(latest))
  return date === todayJerusalem() ? fmtTime(latest) : `${date} ${fmtTime(latest)}`
}

function TopList({ title, items }: { title: string; items: Array<{ key: string; ms: number }> }) {
  return (
    <div>
      <h4>{title}</h4>
      {items.length === 0 ? <p className="muted">none</p> : (
        <ol>{items.map((i) => <li key={i.key}>{i.key} <span className="muted">{fmtDuration(i.ms)}</span></li>)}</ol>
      )}
    </div>
  )
}

function ChildCard({ child, data }: { child: Child; data: HomeData }) {
  const devs = data.devices.filter((d) => d.child_id === child.id)
  const ids = new Set(devs.map((d) => d.id))
  const range = dayRange(todayJerusalem())
  const apps = data.day.apps.filter((a) => ids.has(a.device_id))
  const web = data.day.web.filter((w) => ids.has(w.device_id))
  const status = childStatus(devs, data.last)
  return (
    <li className="card" style={{ '--c': child.color } as CSSProperties}>
      <h3><a href={`#/child/${child.id}`}>{child.name}</a></h3>
      <p className="screen-time">{fmtDuration(screenTimeMs(apps, range))} today</p>
      <p><span className={`dot dot-${status}`} aria-label={`status ${status}`} /> last seen {lastSeen(devs)}</p>
      <TopList title="Top apps" items={topBy(clip(apps, range), (a) => a.process).slice(0, 3)} />
      <TopList title="Top sites" items={topBy(clip(web, range), (w) => w.domain).slice(0, 3)} />
    </li>
  )
}

export function Home() {
  const [data, setData] = useState<HomeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    load().then(
      (d) => { if (live) setData(d) },
      (e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { live = false }
  }, [])
  if (error) return <p role="alert">Could not load data: {error}</p>
  if (!data) return <p>Loading…</p>
  if (data.children.length === 0) return <p>No children yet. Add one in <a href="#/settings">Settings</a>.</p>
  return <ul className="child-list">{data.children.map((c) => <ChildCard key={c.id} child={c} data={data} />)}</ul>
}
