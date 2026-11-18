import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession, select, signInWithPassword } = vi.hoisted(() => ({
  getSession: vi.fn(),
  select: vi.fn(),
  signInWithPassword: vi.fn(),
}))

vi.mock('./supabase.ts', () => ({
  supabase: {
    auth: {
      getSession,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithOAuth: vi.fn(),
      signInWithPassword,
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

  it('signs in with email and password and shows the error on failure', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    render(<App />)
    const email = await screen.findByLabelText('Email')
    expect(email.getAttribute('autocomplete')).toBe('username')
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('current-password')
    fireEvent.change(email, { target: { value: 'a@b.c' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Invalid login credentials')
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.c', password: 'pw' })
  })

  it('show password toggles the input type', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    render(<App />)
    const pw = await screen.findByLabelText('Password')
    fireEvent.click(screen.getByLabelText('Show password'))
    expect(pw.getAttribute('type')).toBe('text')
  })
})
