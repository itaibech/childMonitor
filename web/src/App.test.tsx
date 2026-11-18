import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession, select } = vi.hoisted(() => ({
  getSession: vi.fn(),
  select: vi.fn(),
}))

vi.mock('./supabase.ts', () => ({
  supabase: {
    auth: {
      getSession,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
    },
    from: () => ({ select }),
  },
}))

import { App } from './App.tsx'

describe('App auth gate', () => {
  beforeEach(() => {
    select.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
  })
  afterEach(cleanup)

  it('shows a Google sign-in button without a session', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeTruthy()
  })

  it('shows No access for a non-admin session', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { email: 'someone@x.com' } } } })
    render(<App />)
    expect(await screen.findByText(/No access/)).toBeTruthy()
  })
})
