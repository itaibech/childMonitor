import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { supabase } from './supabase.ts'
import { ChildDay } from './ChildDay.tsx'
import { Home } from './Home.tsx'
import { Settings } from './Settings.tsx'

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

function Page({ route }: { route: Route }) {
  if (route.page === 'settings') return <Settings />
  if (route.page === 'child') return <ChildDay id={route.id} date={route.date} />
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
