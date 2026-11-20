import type { CSSProperties, FormEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import * as data from './data.ts'
import type { Category } from './data.ts'
import type { Child, TimeLimit } from './types.ts'
import { allowedMinutes, fmtDuration, limitName, toPattern } from './usage.ts'
import type { SiteCategory } from './usage.ts'

const MIN = 60_000
const DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360]
const EXTRA = [15, 30, 60]
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

interface Choices {
  limits: TimeLimit[]
  categories: Category[]
  apps: SiteCategory[]
}

function Duration({ value, label, onPick }: { value: number; label: string; onPick: (m: number) => void }) {
  const options = DURATIONS.includes(value) ? DURATIONS : [...DURATIONS, value].sort((a, b) => a - b)
  return (
    <select aria-label={label} value={value} onChange={(e) => onPick(Number(e.target.value))}>
      {options.map((m) => <option key={m} value={m}>{fmtDuration(m * MIN)} a day</option>)}
    </select>
  )
}

function AddLimit({ child, c, run }: { child: Child; c: Choices; run: (p: Promise<unknown>) => void }) {
  const [target, setTarget] = useState('')
  const [app, setApp] = useState('')
  const [minutes, setMinutes] = useState(120)
  const exe = toPattern(app)
  const pick = target === 'app' ? (exe?.kind === 'app' ? { app: exe.pattern } : null) : target ? { category: target } : null
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (pick) run(data.addTimeLimit(child.id, pick, minutes).then(() => { setTarget(''); setApp('') }))
  }
  return (
    <form className="row add-limit" onSubmit={submit}>
      <select aria-label={`Limit for ${child.name} on`} value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">Add a limit on…</option>
        <optgroup label="A whole category">{c.categories.map((k) => <option key={k.name} value={k.name}>{k.name}</option>)}</optgroup>
        <option value="app">One app…</option>
      </select>
      {target === 'app' && <input aria-label="App" list="known-apps" placeholder="robloxplayerbeta.exe" value={app} onChange={(e) => setApp(e.target.value)} />}
      <Duration value={minutes} label="Daily time" onPick={setMinutes} />
      <button className="btn" type="submit" disabled={!pick}>Add limit</button>
    </form>
  )
}

function ChildLimits({ child, c, run }: { child: Child; c: Choices; run: (p: Promise<unknown>) => void }) {
  const mine = c.limits.filter((l) => l.child_id === child.id)
  return (
    <div className="offline" style={{ '--kid': child.color ?? 'var(--harbor)' } as CSSProperties}>
      <h3>{child.name}</h3>
      {mine.length > 0 && (
        <ul className="sort-list">
          {mine.map((l) => (
            <li key={l.id}>
              <span className="name">{limitName(l)}<span className="badge">{l.app ? 'app' : 'category'}</span></span>
              <Duration value={l.minutes} label={`Daily time for ${limitName(l)}`} onPick={(m) => run(data.setLimitMinutes(l.id, m))} />
              <button className="btn btn-quiet" onClick={() => run(data.removeTimeLimit(l.id))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <AddLimit child={child} c={c} run={run} />
    </div>
  )
}

/** Settings: daily limits per child. */
export function LimitsSection({ children }: { children: Child[] }) {
  const [c, setC] = useState<Choices | null>(null)
  const [error, setError] = useState('')
  const reload = useCallback(() => Promise.all([data.fetchTimeLimits(), data.fetchCategories(), data.fetchSiteCategories()])
    .then(([limits, categories, apps]) => setC({ limits, categories, apps: apps.filter((a) => a.kind === 'app') }), (e: unknown) => setError(message(e))), [])
  useEffect(() => { void reload() }, [reload])
  const run = (p: Promise<unknown>) => { setError(''); p.then(reload, (e: unknown) => setError(message(e))) }
  if (children.length === 0) return null
  return (
    <section className="panel">
      <h2>Time limits</h2>
      <p className="muted">A daily limit on one app or a whole category. Five minutes before, the child sees a warning; then the app closes until tomorrow. Give extra time for today on the child's page. Websites aren't limited yet.</p>
      {error && <p role="alert">{error}</p>}
      {c && <datalist id="known-apps">{c.apps.map((a) => <option key={a.pattern} value={a.pattern}>{a.category}</option>)}</datalist>}
      {c && children.map((k) => <ChildLimits key={k.id} child={k} c={c} run={run} />)}
    </section>
  )
}

/** Child's Today page: used / allowed per limit, with extra time for today. */
export function TodayLimits({ limits, used, today, onChange }: {
  limits: TimeLimit[]; used: (l: TimeLimit) => number; today: string; onChange: () => void
}) {
  const [error, setError] = useState('')
  const run = (p: Promise<unknown>) => { setError(''); p.then(onChange, (e: unknown) => setError(message(e))) }
  if (limits.length === 0) return null
  return (
    <section className="panel">
      <h2>Time limits today</h2>
      {error && <p role="alert">{error}</p>}
      <ul className="limits">
        {limits.map((l) => {
          const allowed = allowedMinutes(l, today) * MIN
          const ms = used(l)
          const extra = l.extra_on === today ? l.extra_minutes : 0
          return (
            <li key={l.id} className={ms >= allowed ? 'over' : undefined}>
              <span className="name">{limitName(l)}</span>
              <span className="muted">{fmtDuration(ms)} of {fmtDuration(allowed)}{extra > 0 && ` (${extra}m extra)`}{ms >= allowed && ' · Blocked'}</span>
              <meter min={0} max={allowed || 1} value={Math.min(ms, allowed)} aria-label={`${limitName(l)} used`} />
              <span className="extend">
                {EXTRA.map((m) => <button key={m} className="btn btn-quiet" onClick={() => run(data.extendLimit(l.id, m))}>+{m}m</button>)}
                {extra > 0 && <button className="btn btn-quiet" onClick={() => run(data.extendLimit(l.id, -extra))}>Undo extra</button>}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="muted">Extra time is for today only and reaches the laptop within a minute.</p>
    </section>
  )
}
