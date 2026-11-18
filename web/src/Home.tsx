import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import { fetchChildren, fetchDay, fetchDevices, fetchLastEvents } from './data.ts'
import type { DayData } from './data.ts'
import { deviceStatus } from './health.ts'
import type { DeviceStatus } from './health.ts'
import type { Child, Device, DeviceEvent } from './types.ts'
import { byHour, clip, dayRange, fmtDuration, fmtTime, screenTimeMs, todayJerusalem, topBy } from './usage.ts'
import { DayClock, HomeArt } from './art.tsx'

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

const STATUS: Record<DeviceStatus | 'none', string> = {
  ok: 'Reporting',
  off: 'Off or asleep',
  silent: 'Not reporting',
  none: 'No laptop yet',
}

function TopList({ title, items }: { title: string; items: Array<{ key: string; ms: number }> }) {
  const max = items[0]?.ms ?? 1
  return (
    <div className="top">
      <h4>{title}</h4>
      {items.length === 0 ? <p className="muted">Nothing yet today</p> : (
        <ol className="bars">
          {items.map((i) => (
            <li key={i.key} style={{ '--w': i.ms / max } as CSSProperties}>
              <span className="name">{i.key}</span><span className="time">{fmtDuration(i.ms)}</span>
            </li>
          ))}
        </ol>
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
  const color = child.color ?? 'var(--harbor)'
  return (
    <li className="kid-card" style={{ '--kid': color } as CSSProperties}>
      <a className="kid-head" href={`#/child/${child.id}`}>
        <DayClock minutes={byHour(apps, range)} totalMs={screenTimeMs(apps, range)} color={color} />
        <div>
          <h2>{child.name}</h2>
          <p className={`status status-${status}`}>{STATUS[status]}</p>
          <p className="muted">Last seen {lastSeen(devs)}</p>
        </div>
      </a>
      <div className="tops">
        <TopList title="Apps" items={topBy(clip(apps, range), (a) => a.process).slice(0, 3)} />
        <TopList title="Sites" items={topBy(clip(web, range), (w) => w.domain).slice(0, 3)} />
      </div>
    </li>
  )
}

function Empty() {
  return (
    <section className="empty">
      <HomeArt />
      <h1>Add your children to get started</h1>
      <p className="lede">Add each child, then install Child Monitor on their laptop.</p>
      <a className="btn btn-big" href="#/settings">Add a child</a>
    </section>
  )
}

const TODAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long' })

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
  if (!data) return <p className="muted">Loading…</p>
  if (data.children.length === 0) return <Empty />
  return (
    <div className="page">
      <h1>Today <span className="date">{TODAY.format(new Date())}</span></h1>
      <ul className="kid-grid">{data.children.map((c) => <ChildCard key={c.id} child={c} data={data} />)}</ul>
    </div>
  )
}
