import type { CSSProperties, FormEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Skeleton } from './art.tsx'
import * as data from './data.ts'
import type { Category, Unsorted } from './data.ts'
import { fmtDuration, toPattern } from './usage.ts'
import type { SiteCategory } from './usage.ts'

interface State {
  list: Category[]
  rows: SiteCategory[]
  queue: Unsorted[]
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function load(): Promise<State> {
  const [list, rows, queue] = await Promise.all([data.fetchCategories(), data.fetchSiteCategories(), data.fetchUncategorized()])
  return { list, rows, queue }
}

function Pick({ list, value, label, onPick }: { list: Category[]; value: string; label: string; onPick: (c: string) => void }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => { if (e.target.value) onPick(e.target.value) }}>
      <option value="">Choose a category…</option>
      {list.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
    </select>
  )
}

function Queue({ s, run }: { s: State; run: (p: Promise<unknown>) => void }) {
  return (
    <section className="panel">
      <h2>Needs a category</h2>
      <p className="muted">Sites and apps from the last 30 days that aren't in any category, most used first.</p>
      {s.queue.length === 0 ? <p className="ok-note">Everything has a category.</p> : (
        <ul className="sort-list">
          {s.queue.map((u) => (
            <li key={`${u.kind}-${u.name}`}>
              <span className="name">{u.name}<span className="badge">{u.kind}</span></span>
              <span className="muted time">{fmtDuration(u.ms)}</span>
              <Pick list={s.list} value="" label={`Category for ${u.name}`} onPick={(c) => run(data.setSiteCategory(u.kind, u.name.replace(/^www\./, ''), c))} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function AddEntry({ list, run }: { list: Category[]; run: (p: Promise<unknown>) => void }) {
  const [text, setText] = useState('')
  const [category, setCategory] = useState('')
  const entry = toPattern(text)
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!entry || !category) return
    run(data.setSiteCategory(entry.kind, entry.pattern, category).then(() => setText('')))
  }
  return (
    <form className="row add-entry" onSubmit={submit}>
      <input aria-label="Site or app" placeholder="example.com or game.exe" value={text} onChange={(e) => setText(e.target.value)} />
      <Pick list={list} value={category} label="Category" onPick={setCategory} />
      <button className="btn" type="submit" disabled={!entry || !category}>Save</button>
      {text && !entry && <span className="muted">Type a site like example.com, or an app like game.exe</span>}
    </form>
  )
}

function CategoryRow({ c, count, run }: { c: Category; count: number; run: (p: Promise<unknown>) => void }) {
  const rename = () => {
    const next = prompt('New name', c.name)?.trim()
    if (next && next !== c.name) run(data.updateCategory(c.name, { name: next }))
  }
  const remove = () => {
    if (confirm(`Delete ${c.name}? Its ${count} sites and apps go back to "Needs a category".`)) run(data.deleteCategory(c.name))
  }
  return (
    <li style={{ '--c': c.color } as CSSProperties}>
      <input type="color" aria-label={`Color of ${c.name}`} defaultValue={c.color} onBlur={(e) => { if (e.target.value !== c.color) run(data.updateCategory(c.name, { color: e.target.value })) }} />
      <span className="name">{c.name}</span>
      <span className="muted">{count} sites and apps</span>
      <button className="btn btn-quiet" onClick={rename}>Rename</button>
      <button className="btn btn-danger" onClick={remove}>Delete</button>
    </li>
  )
}

function CategoryList({ s, run }: { s: State; run: (p: Promise<unknown>) => void }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#5b9fd0')
  const count = (c: string) => s.rows.filter((r) => r.category === c).length
  return (
    <section className="panel">
      <h2>Categories</h2>
      <ul className="cat-list">{s.list.map((c) => <CategoryRow key={c.name} c={c} count={count(c.name)} run={run} />)}</ul>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) run(data.addCategory(name.trim(), color).then(() => setName(''))) }}>
        <input aria-label="New category name" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="color" aria-label="New category color" value={color} onChange={(e) => setColor(e.target.value)} />
        <button className="btn" type="submit" disabled={!name.trim()}>Add category</button>
      </form>
    </section>
  )
}

function Choices({ s, run }: { s: State; run: (p: Promise<unknown>) => void }) {
  const mine = s.rows.filter((r) => r.source === 'manual')
  return (
    <section className="panel">
      <h2>Your choices</h2>
      <p className="muted">Add any site or app yourself; your choice always wins over the built-in list ({s.rows.length - mine.length} sites and apps).</p>
      <AddEntry list={s.list} run={run} />
      {mine.length > 0 && (
        <ul className="sort-list">
          {mine.map((r) => (
            <li key={`${r.kind}-${r.pattern}`}>
              <span className="name">{r.pattern}<span className="badge">{r.kind}</span></span>
              <Pick list={s.list} value={r.category} label={`Category for ${r.pattern}`} onPick={(c) => run(data.setSiteCategory(r.kind, r.pattern, c))} />
              <button className="btn btn-quiet" onClick={() => run(data.removeSiteCategory(r.kind, r.pattern))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Loads categories, entries and the queue; run() saves a change, then reloads. */
function useCategories() {
  const [s, setS] = useState<State | null>(null)
  const [error, setError] = useState('')
  const reload = useCallback(() => load().then(setS, (e: unknown) => setError(message(e))), [])
  useEffect(() => { void reload() }, [reload])
  const run = (p: Promise<unknown>) => { setError(''); p.then(reload, (e: unknown) => setError(message(e))) }
  return { s, error, run }
}

/** The category list on its own, for the Settings page. */
export function CategorySettings() {
  const { s, error, run } = useCategories()
  if (!s) return error ? <p role="alert">Could not load categories: {error}</p> : <Skeleton />
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <CategoryList s={s} run={run} />
      <p className="muted">Sort sites and apps into them on the <a href="#/categories">Categories page</a>.</p>
    </>
  )
}

export function Categories() {
  const { s, error, run } = useCategories()
  if (!s) return error ? <p role="alert">Could not load categories: {error}</p> : <Skeleton />
  return (
    <div className="page">
      <h1>Categories</h1>
      <p className="lede">Each site and app belongs to a category, so you can see what the time goes on: school, games, video and so on.</p>
      {error && <p role="alert">{error}</p>}
      <Queue s={s} run={run} />
      <Choices s={s} run={run} />
      <CategoryList s={s} run={run} />
    </div>
  )
}
