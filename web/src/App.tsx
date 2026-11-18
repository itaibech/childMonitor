import type { Session } from '@supabase/supabase-js'
import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from './supabase.ts'
import { HomeArt, Logo } from './art.tsx'
import { ChildDay } from './ChildDay.tsx'
import { Diagnose, Download } from './Download.tsx'
import { Home } from './Home.tsx'
import { Settings } from './Settings.tsx'

const ADMIN = 'itai.bechor@gmail.com'

export type Route =
  | { page: 'home' }
  | { page: 'child'; id: string; date: string | null; week: boolean }
  | { page: 'settings' }
  | { page: 'download' }
  | { page: 'diagnose' }

export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?')
  const parts = path.split('/')
  if (parts[0] === 'settings') return { page: 'settings' }
  if (parts[0] === 'download') return { page: 'download' }
  if (parts[0] === 'diagnose') return { page: 'diagnose' }
  if (parts[0] === 'child' && parts[1]) {
    const q = new URLSearchParams(query)
    return { page: 'child', id: parts[1], date: q.get('date'), week: q.get('view') === 'week' }
  }
  return { page: 'home' }
}

function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  return session
}

function useRoute(): Route {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return parseRoute(hash)
}

function Nav({ page }: { page: Route['page'] }) {
  const link = (href: string, label: string, on: boolean) => <a href={href} aria-current={on ? 'page' : undefined}>{label}</a>
  return (
    <header className="topbar">
      <nav aria-label="Main">
        <a className="brand" href="#/"><Logo />Child Monitor</a>
        {link('#/', 'Today', page === 'home' || page === 'child')}
        {link('#/download', 'Install', page === 'download')}
        {link('#/settings', 'Settings', page === 'settings')}
        {link('#/diagnose', 'Diagnostics', page === 'diagnose')}
      </nav>
      <button className="btn btn-quiet" onClick={() => void supabase.auth.signOut()}>Sign out</button>
    </header>
  )
}

function Page({ route }: { route: Route }) {
  if (route.page === 'settings') return <Settings />
  if (route.page === 'download') return <Download />
  if (route.page === 'diagnose') return <Diagnose />
  if (route.page === 'child') return <ChildDay id={route.id} date={route.date} week={route.week} />
  return <Home />
}

function SignIn() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [show, setShow] = useState(false)
  const google = () =>
    supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } })
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: String(form.get('email')), password: String(form.get('password')) })
    setBusy(false)
    setError(error?.message ?? '')
  }
  return (
    <main className="signin">
      <HomeArt />
      <h1>Child Monitor</h1>
      <p className="lede">See how the children spend their time on their laptops.</p>
      <form onSubmit={(e) => void submit(e)}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" spellCheck={false} required />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type={show ? 'text' : 'password'} autoComplete="current-password" enterKeyHint="done" required />
        <label><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show password</label>
        {error && <p role="alert">{error}</p>}
        <button className="btn" type="submit" disabled={busy}>Sign in</button>
      </form>
      <button className="btn btn-quiet" onClick={() => void google()}>Sign in with Google</button>
    </main>
  )
}

export function App() {
  const session = useSession()
  const route = useRoute()
  if (session === undefined) return null
  if (!session) return <SignIn />
  if (session.user.email !== ADMIN) {
    return (
      <main className="signin">
        <p role="alert">No access for {session.user.email}. Sign in with the parent account.</p>
        <button className="btn btn-quiet" onClick={() => void supabase.auth.signOut()}>Sign out</button>
      </main>
    )
  }
  return (
    <>
      <Nav page={route.page} />
      <main className="shell"><Page route={route} /></main>
    </>
  )
}
