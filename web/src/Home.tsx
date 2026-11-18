import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import { fetchChildren, fetchDay, fetchDevices, fetchLastEvents } from './data.ts'
import type { DayData } from './data.ts'
import { deviceStatus } from './health.ts'
import type { DeviceStatus } from './health.ts'
import type { Child, Device, DeviceEvent } from './types.ts'
import { addDays, byHour, clip, dailyMs, dayRange, fmtDuration, fmtTime, lateMs, screenTimeMs, spanRange, todayJerusalem, topBy, weekDates } from './usage.ts'
import { Avatar, Columns, DayClock, HomeArt, Skeleton } from './art.tsx'

interface HomeData {
  children: Child[]
  devices: Device[]
  day: DayData
  last: Map<string, DeviceEvent>
}

async function load(): Promise<HomeData> {
  const [children, devices] = await Promise.all([fetchChildren(), fetchDevices()])
  const ids = devices.map((d) => d.id)
  // Today plus the 7 days before it: the mini chart, the average and last night's late use.
  const today = todayJerusalem()
  const [day, last] = await Promise.all([fetchDay(ids, spanRange(addDays(today, -7), today)), fetchLastEvents(ids)])
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

function Trend({ apps, color }: { apps: DayData['apps']; color: string }) {
  const today = todayJerusalem()
  const days = dailyMs(apps, weekDates(today))
  const avg = dailyMs(apps, weekDates(addDays(today, -1))).reduce((s, d) => s + d, 0) / 7
  const text = avg < 60_000 ? 'Last 7 days' : `Usually ${fmtDuration(avg)} a day`
  return (
    <div className="trend" style={{ '--kid': color } as CSSProperties}>
      <Columns mini values={days} avg={avg} label={`Screen time over the last 7 days; today ${fmtDuration(days[6])}`} labels={[]}
        titles={weekDates(today).map((d, i) => `${d}: ${fmtDuration(days[i])}`)} />
      <span className="muted">{text}</span>
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
          <div className="kid-name"><Avatar child={child} size={40} /><h2>{child.name}</h2></div>
          <p className={`status status-${status}`}>{STATUS[status]}</p>
          <p className="muted">Last seen {lastSeen(devs)}</p>
        </div>
      </a>
      <Trend apps={apps} color={color} />
      <div className="tops">
        <TopList title="Apps" items={topBy(clip(apps, range), (a) => a.process).slice(0, 3)} />
        <TopList title="Sites" items={topBy(clip(web, range), (w) => w.domain).slice(0, 3)} />
      </div>
      <a className="more" href={`#/child/${child.id}?view=week`}>See the week</a>
    </li>
  )
}

interface Alert {
  key: string
  text: string
  href: string
}

/** Things worth a parent's attention today, most urgent first. */
function alerts(data: HomeData): Alert[] {
  const today = todayJerusalem()
  const out: Alert[] = []
  for (const c of data.children) {
    const devs = data.devices.filter((d) => d.child_id === c.id)
    const ids = new Set(devs.map((d) => d.id))
    if (devs.length > 0 && childStatus(devs, data.last) === 'silent')
      out.push({ key: `${c.id}-silent`, text: `${c.name}'s laptop isn't reporting`, href: '#/diagnose' })
    const blocked = data.day.events.filter((e) => ids.has(e.device_id) && e.kind === 'browser_blocked' && e.at >= dayRange(today).start.toISOString()).length
    if (blocked > 0) out.push({ key: `${c.id}-blocked`, text: `${c.name} tried to open a blocked browser ${blocked === 1 ? 'once' : `${blocked} times`} today`, href: `#/child/${c.id}` })
    const late = lateMs(data.day.apps.filter((a) => ids.has(a.device_id)), addDays(today, -1))
    if (late >= 5 * 60_000) out.push({ key: `${c.id}-late`, text: `${c.name} used the laptop for ${fmtDuration(late)} late last night`, href: `#/child/${c.id}?date=${addDays(today, -1)}` })
  }
  return out
}

function Alerts({ items }: { items: Alert[] }) {
  if (items.length === 0) return null
  return (
    <section className="alerts" aria-label="Needs attention">
      <ul>{items.map((a) => <li key={a.key}><a href={a.href}>{a.text}</a></li>)}</ul>
    </section>
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
  if (!data) return <Skeleton />
  if (data.children.length === 0) return <Empty />
  return (
    <div className="page">
      <h1>Today <span className="date">{TODAY.format(new Date())}</span></h1>
      <Alerts items={alerts(data)} />
      <ul className="kid-grid">{data.children.map((c) => <ChildCard key={c.id} child={c} data={data} />)}</ul>
    </div>
  )
}
