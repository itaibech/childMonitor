import { useEffect, useState } from 'react'
import { fetchChildren, fetchDay, fetchDevices } from './data.ts'
import type { DayData } from './data.ts'
import type { Child, DeviceEvent } from './types.ts'
import { byHour, clip, dayRange, fmtDuration, fmtTime, screenTimeMs, topBy, validDate } from './usage.ts'
import type { Range } from './usage.ts'

interface Loaded {
  child: Child | undefined
  day: DayData
}

interface Entry {
  at: string
  kind: 'app' | 'site' | 'event'
  label: string
  user: string
  blocked: boolean
}

async function load(id: string, range: Range): Promise<Loaded> {
  const [children, devices] = await Promise.all([fetchChildren(), fetchDevices()])
  const ids = devices.filter((d) => d.child_id === id).map((d) => d.id)
  return { child: children.find((c) => c.id === id), day: await fetchDay(ids, range) }
}

function filterUser(day: DayData, user: string): DayData {
  if (!user) return day
  const keep = <T extends { win_user: string }>(rows: T[]) => rows.filter((r) => r.win_user === user)
  return { apps: keep(day.apps), web: keep(day.web), events: keep(day.events) }
}

function eventLabel(e: DeviceEvent): string {
  const exe = e.detail?.exe
  return e.kind === 'browser_blocked' && typeof exe === 'string' ? `${e.kind} ${exe}` : e.kind
}

function timeline(day: DayData): Entry[] {
  const apps = day.apps.map((a): Entry => ({ at: a.started_at, kind: 'app', label: `${a.process} ${a.title}`, user: a.win_user, blocked: false }))
  const sites = day.web.map((w): Entry => ({ at: w.started_at, kind: 'site', label: `${w.domain} ${w.title}`, user: w.win_user, blocked: false }))
  const events = day.events.filter((e) => e.kind !== 'heartbeat').map((e): Entry => ({ at: e.at, kind: 'event', label: eventLabel(e), user: e.win_user, blocked: e.kind === 'browser_blocked' }))
  return [...apps, ...sites, ...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

function HourBars({ day, range }: { day: DayData; range: Range }) {
  const bars = byHour(day.apps, range)
  return (
    <div className="hours">
      {bars.map((min, i) => {
        const label = fmtTime(range.start.getTime() + i * 3_600_000)
        return (
          <div key={i} className="hour" title={`${label}: ${Math.round(min)} min`}>
            <div className="bar" style={{ height: `${(min / 60) * 100}%` }} />
            <span>{label.slice(0, 2)}</span>
          </div>
        )
      })}
    </div>
  )
}

function Totals({ title, rows }: { title: string; rows: Array<{ key: string; ms: number }> }) {
  return (
    <section>
      <h3>{title}</h3>
      <table>
        <tbody>
          {rows.map((r) => <tr key={r.key}><td>{r.key}</td><td>{fmtDuration(r.ms)}</td></tr>)}
          {rows.length === 0 && <tr><td className="muted">none</td></tr>}
        </tbody>
      </table>
    </section>
  )
}

function Timeline({ entries }: { entries: Entry[] }) {
  return (
    <section>
      <h3>Timeline</h3>
      <ul className="timeline">
        {entries.map((e, i) => (
          <li key={`${e.at}-${i}`} className={e.blocked ? 'blocked' : undefined}>
            {fmtTime(e.at)} <b>{e.kind}</b> {e.label} <span className="muted">{e.user}</span>
          </li>
        ))}
        {entries.length === 0 && <li className="muted">nothing recorded</li>}
      </ul>
    </section>
  )
}

function Controls(p: { date: string; user: string; users: string[]; onUser: (u: string) => void; id: string }) {
  return (
    <p className="controls">
      <input type="date" aria-label="Date" value={p.date} onChange={(e) => { location.hash = `#/child/${p.id}?date=${e.target.value}` }} />
      <select aria-label="Windows account" value={p.user} onChange={(e) => p.onUser(e.target.value)}>
        <option value="">All accounts</option>
        {p.users.map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
    </p>
  )
}

function Body({ day, range }: { day: DayData; range: Range }) {
  const apps = clip(day.apps, range)
  const web = clip(day.web, range)
  return (
    <>
      <p className="screen-time">{fmtDuration(screenTimeMs(day.apps, range))} screen time</p>
      <HourBars day={day} range={range} />
      <Totals title="Apps" rows={topBy(apps, (a) => a.process)} />
      <Totals title="Sites" rows={topBy(web, (w) => w.domain)} />
      <Timeline entries={timeline(day)} />
    </>
  )
}

export function ChildDay({ id, date }: { id: string; date: string | null }) {
  const day = validDate(date)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState('')
  useEffect(() => {
    let live = true
    setLoaded(null)
    setError(null)
    load(id, dayRange(day)).then(
      (l) => { if (live) setLoaded(l) },
      (e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { live = false }
  }, [id, day])
  useEffect(() => setUser(''), [id])
  if (error) return <p role="alert">Could not load data: {error}</p>
  if (!loaded) return <p>Loading…</p>
  if (!loaded.child) return <p role="alert">Child not found</p>
  const all = loaded.day
  const users = [...new Set([...all.apps, ...all.web, ...all.events].map((r) => r.win_user))].filter((u) => u !== '').sort()
  return (
    <div>
      <h2>{loaded.child.name}</h2>
      <Controls date={day} user={user} users={users} onUser={setUser} id={id} />
      <Body day={filterUser(all, user)} range={dayRange(day)} />
    </div>
  )
}
