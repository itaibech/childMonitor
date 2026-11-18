import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Columns, DayClock, Donut, Heatmap, Skeleton } from './art.tsx'
import { fetchChildren, fetchDay, fetchDevices } from './data.ts'
import type { DayData } from './data.ts'
import type { Child, DeviceEvent } from './types.ts'
import {
  addDays, byCategory, byHour, clip, dailyMs, dayFacts, dayRange, fmtDuration, fmtTime, screenTimeMs, spanRange,
  todayJerusalem, topBy, validDate, weekDates,
} from './usage.ts'
import type { Range } from './usage.ts'

interface Loaded {
  child: Child | undefined
  data: DayData
}

interface Entry {
  at: string
  kind: 'app' | 'site' | 'event'
  label: string
  user: string
  blocked: boolean
}

const MIN = 60_000
const WEEKDAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric' })
const LONG_DATE = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
const dayLabel = (date: string) => WEEKDAY.format(new Date(`${date}T12:00:00Z`))

/** Day view needs one day; week view needs this week and the one before, for the comparison. */
async function load(id: string, date: string, week: boolean): Promise<Loaded> {
  const [children, devices] = await Promise.all([fetchChildren(), fetchDevices()])
  const ids = devices.filter((d) => d.child_id === id).map((d) => d.id)
  const range = week ? spanRange(addDays(date, -13), date) : dayRange(date)
  return { child: children.find((c) => c.id === id), data: await fetchDay(ids, range) }
}

function filterUser(day: DayData, user: string): DayData {
  if (!user) return day
  const keep = <T extends { win_user: string }>(rows: T[]) => rows.filter((r) => r.win_user === user)
  return { apps: keep(day.apps), web: keep(day.web), events: keep(day.events) }
}

const EVENT_LABEL: Record<string, string> = {
  logon: 'Signed in', logoff: 'Signed out', lock: 'Locked', unlock: 'Unlocked', suspend: 'Went to sleep', resume: 'Woke up',
  shutdown: 'Shut down', agent_start: 'Monitor started', browser_blocked: 'Blocked browser',
}

function eventLabel(e: DeviceEvent): string {
  const exe = e.detail?.exe
  const label = EVENT_LABEL[e.kind] ?? e.kind
  return e.kind === 'browser_blocked' && typeof exe === 'string' ? `${label}: ${exe}` : label
}

function timeline(day: DayData): Entry[] {
  const apps = day.apps.map((a): Entry => ({ at: a.started_at, kind: 'app', label: `${a.process} ${a.title}`, user: a.win_user, blocked: false }))
  const sites = day.web.map((w): Entry => ({ at: w.started_at, kind: 'site', label: `${w.domain} ${w.title}`, user: w.win_user, blocked: false }))
  const events = day.events.filter((e) => e.kind !== 'heartbeat').map((e): Entry => ({ at: e.at, kind: 'event', label: eventLabel(e), user: e.win_user, blocked: e.kind === 'browser_blocked' }))
  return [...apps, ...sites, ...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel"><h2>{title}</h2>{children}</section>
}

function Nothing() {
  return <p className="muted">Nothing recorded. If the laptop was used, check <a href="#/diagnose">Diagnostics</a>.</p>
}

function Totals({ title, rows }: { title: string; rows: Array<{ key: string; ms: number }> }) {
  const max = rows[0]?.ms ?? 1
  return (
    <Panel title={title}>
      {rows.length === 0 ? <Nothing /> : (
        <ol className="bars">
          {rows.slice(0, 10).map((r) => (
            <li key={r.key} style={{ '--w': r.ms / max } as CSSProperties}>
              <span className="name">{r.key}</span><span className="time">{fmtDuration(r.ms)}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

function Categories({ data, range }: { data: DayData; range: Range }) {
  const parts = byCategory(data.apps, data.web, range)
  const total = parts.reduce((s, p) => s + p.ms, 0)
  return <Panel title="By category">{total === 0 ? <Nothing /> : <Donut parts={parts} total={total} />}</Panel>
}

const KIND: Record<Entry['kind'], string> = { app: 'App', site: 'Site', event: 'Laptop' }

function Timeline({ entries }: { entries: Entry[] }) {
  return (
    <Panel title="Timeline">
      {entries.length === 0 ? <Nothing /> : (
        <ol className="timeline">
          {entries.map((e, i) => (
            <li key={`${e.at}-${i}`} className={`kind-${e.kind}${e.blocked ? ' blocked' : ''}`}>
              <time dateTime={e.at}>{fmtTime(e.at)}</time>
              <span className="what"><span className="kind">{KIND[e.kind]}</span> {e.label}</span>
              <span className="muted who">{e.user}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

function Stats({ items }: { items: Array<[string, string, boolean?]> }) {
  return (
    <dl className="stats">
      {items.map(([k, v, warn]) => <div key={k} className={warn ? 'warn' : undefined}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  )
}

function DayStats({ data, date }: { data: DayData; date: string }) {
  const f = dayFacts(data.apps, dayRange(date))
  const { start, end } = dayRange(date)
  const at = (h: number) => new Date(start.getTime() + h * 3_600_000)
  // Before 05:00 and after 22:00 on this day
  const late = screenTimeMs(data.apps, { start, end: at(5) }) + screenTimeMs(data.apps, { start: at(22), end })
  const blocked = data.events.filter((e) => e.kind === 'browser_blocked').length
  return (
    <Stats items={[
      ['First use', f.first ? fmtTime(f.first) : '–'],
      ['Last use', f.last ? fmtTime(f.last) : '–'],
      ['Longest stretch', fmtDuration(f.longestMs), f.longestMs >= 90 * MIN],
      ['Late at night', fmtDuration(late), late >= 5 * MIN],
      ['Blocked browsers', String(blocked), blocked > 0],
    ]} />
  )
}

function DayBody({ data, date }: { data: DayData; date: string }) {
  const range = dayRange(date)
  const hours = byHour(data.apps, range)
  const hourLabel = (i: number) => String(i).padStart(2, '0')
  return (
    <>
      <DayStats data={data} date={date} />
      <Panel title="Hour by hour">
        <Columns values={hours} max={60} label="Minutes used in each hour"
          labels={hours.map((_, i) => (i % 3 === 0 ? hourLabel(i) : ''))} titles={hours.map((m, i) => `${hourLabel(i)}:00 · ${Math.round(m)} min`)} />
      </Panel>
      <div className="two">
        <Categories data={data} range={range} />
        <Totals title="Apps" rows={topBy(clip(data.apps, range), (a) => a.process)} />
      </div>
      <Totals title="Sites" rows={topBy(clip(data.web, range), (w) => w.domain)} />
      <Timeline entries={timeline(data)} />
    </>
  )
}

function WeekBody({ data, date }: { data: DayData; date: string }) {
  const dates = weekDates(date)
  const range = spanRange(dates[0], date)
  const days = dailyMs(data.apps, dates)
  const avg = days.reduce((s, d) => s + d, 0) / 7
  return (
    <>
      <Panel title="Each day">
        <Columns values={days.map((ms) => ms / MIN)} avg={avg / MIN} label={`Daily screen time, average ${fmtDuration(avg)}`}
          labels={dates.map(dayLabel)} titles={dates.map((d, i) => `${dayLabel(d)} · ${fmtDuration(days[i])}`)} />
        <p className="muted chart-note">Dashed line: daily average, {fmtDuration(avg)}</p>
      </Panel>
      <Panel title="When the laptop is used">
        <Heatmap rows={dates.map((d) => byHour(data.apps, dayRange(d)))} days={dates.map(dayLabel)} />
      </Panel>
      <div className="two">
        <Categories data={data} range={range} />
        <Totals title="Apps" rows={topBy(clip(data.apps, range), (a) => a.process)} />
      </div>
      <Totals title="Sites" rows={topBy(clip(data.web, range), (w) => w.domain)} />
    </>
  )
}

function weekSummary(data: DayData, date: string): string {
  const avg = (ds: string[]) => dailyMs(data.apps, ds).reduce((s, d) => s + d, 0) / 7
  const now = avg(weekDates(date))
  const before = avg(weekDates(addDays(date, -7)))
  const base = `${fmtDuration(now)} a day on average`
  if (before < 5 * MIN) return base
  const pct = Math.round(((now - before) / before) * 100)
  return pct === 0 ? `${base}, same as the week before` : `${base}, ${Math.abs(pct)}% ${pct > 0 ? 'more' : 'less'} than the week before`
}

const href = (id: string, date: string, week: boolean) => `#/child/${id}?date=${date}${week ? '&view=week' : ''}`

function Header({ child, data, date, week }: { child: Child; data: DayData; date: string; week: boolean }) {
  const range = dayRange(date)
  const total = screenTimeMs(data.apps, range)
  const when = week ? `Week to ${LONG_DATE.format(new Date(`${date}T12:00:00Z`))}` : LONG_DATE.format(new Date(`${date}T12:00:00Z`))
  return (
    <header className="kid-banner">
      <DayClock minutes={byHour(data.apps, range)} totalMs={total} color="var(--kid)" size={150} />
      <div>
        <a className="back" href="#/">All children</a>
        <h1>{child.name}</h1>
        <p className="when">{when}</p>
        <p className="lede">{week ? weekSummary(data, date) : `${fmtDuration(total)} on the laptop`}</p>
      </div>
    </header>
  )
}

function Controls(p: { id: string; date: string; week: boolean; user: string; users: string[]; onUser: (u: string) => void }) {
  const step = p.week ? 7 : 1
  const today = todayJerusalem()
  const next = addDays(p.date, step)
  return (
    <div className="controls">
      <nav className="tabs" aria-label="View">
        <a href={href(p.id, p.date, false)} aria-current={p.week ? undefined : 'page'}>Day</a>
        <a href={href(p.id, p.date, true)} aria-current={p.week ? 'page' : undefined}>Week</a>
      </nav>
      <div className="stepper">
        <a className="btn btn-quiet" href={href(p.id, addDays(p.date, -step), p.week)} aria-label={p.week ? 'Previous week' : 'Previous day'}>‹</a>
        <input type="date" aria-label="Date" value={p.date} max={today} onChange={(e) => { if (e.target.value) location.hash = href(p.id, e.target.value, p.week) }} />
        {next <= today
          ? <a className="btn btn-quiet" href={href(p.id, next, p.week)} aria-label={p.week ? 'Next week' : 'Next day'}>›</a>
          : <span className="btn btn-quiet" aria-disabled="true">›</span>}
        {p.date !== today && <a className="btn btn-quiet" href={href(p.id, today, p.week)}>Today</a>}
      </div>
      {p.users.length > 1 && (
        <select aria-label="Windows account" value={p.user} onChange={(e) => p.onUser(e.target.value)}>
          <option value="">All accounts</option>
          {p.users.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      )}
    </div>
  )
}

function useLoaded(id: string, date: string, week: boolean): { loaded: Loaded | null; error: string | null } {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setLoaded(null)
    setError(null)
    load(id, date, week).then(
      (l) => { if (live) setLoaded(l) },
      (e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { live = false }
  }, [id, date, week])
  return { loaded, error }
}

export function ChildDay({ id, date, week = false }: { id: string; date: string | null; week?: boolean }) {
  const day = validDate(date)
  const { loaded, error } = useLoaded(id, day, week)
  const [user, setUser] = useState('')
  useEffect(() => setUser(''), [id])
  if (error) return <p role="alert">Could not load data: {error}</p>
  if (!loaded) return <Skeleton />
  if (!loaded.child) return <p role="alert">Child not found. <a href="#/">Back to all children</a></p>
  const all = loaded.data
  const users = [...new Set([...all.apps, ...all.web, ...all.events].map((r) => r.win_user))].filter((u) => u !== '').sort()
  const data = filterUser(all, user)
  return (
    <div className="page" style={{ '--kid': loaded.child.color ?? 'var(--harbor)' } as CSSProperties}>
      <Header child={loaded.child} data={data} date={day} week={week} />
      <Controls id={id} date={day} week={week} user={user} users={users} onUser={setUser} />
      {week ? <WeekBody data={data} date={day} /> : <DayBody data={data} date={day} />}
    </div>
  )
}
