import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { supabase } from './supabase.ts'
import type { Child } from './types.ts'

const ADMIN = 'itai.bechor@gmail.com'

export type Route =
  | { page: 'home' }
  | { page: 'child'; id: string; date: string | null }
  | { page: 'settings' }

export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?')
  const parts = path.split('/')
  if (parts[0] === 'settings') return { page: 'settings' }
  if (parts[0] === 'child' && parts[1]) {
    return { page: 'child', id: parts[1], date: new URLSearchParams(query).get('date') }
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

function Home() {
  const [children, setChildren] = useState<Child[] | null>(null)
  const [denied, setDenied] = useState(false)
  useEffect(() => {
    supabase.from('children').select('*').then(({ data, error }) => {
      if (error) setDenied(true)
      else setChildren(data as Child[])
    })
  }, [])
  if (denied) return <p role="alert">No access</p>
  if (!children) return null
  return (
    <ul className="child-list">
      {children.map((c) => (
        <li key={c.id}><a href={`#/child/${c.id}`} style={{ '--c': c.color } as React.CSSProperties}>{c.name}</a></li>
      ))}
    </ul>
  )
}

function Page({ route }: { route: Route }) {
  if (route.page === 'settings') return <h2>Settings</h2>
  if (route.page === 'child') return <h2>Child {route.id} {route.date ?? ''}</h2>
  return <Home />
}

export function App() {
  const session = useSession()
  const route = useRoute()
  const signIn = () =>
    supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } })
  if (session === undefined) return null
  if (!session) return <main className="shell"><button className="btn" onClick={signIn}>Sign in with Google</button></main>
  if (session.user.email !== ADMIN) {
    return <main className="shell"><p role="alert">No access: {session.user.email}</p></main>
  }
  return (
    <main className="shell">
      <nav className="nav">
        <a href="#/">Child Monitor</a><a href="#/settings">Settings</a><span className="spacer" />
        <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </nav>
      <Page route={route} />
    </main>
  )
}
