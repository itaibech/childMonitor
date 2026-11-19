import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  fetchCategories: vi.fn(),
  fetchSiteCategories: vi.fn(),
  fetchUncategorized: vi.fn(),
  setSiteCategory: vi.fn(),
  removeSiteCategory: vi.fn(),
  addCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
}))
vi.mock('./data.ts', () => m)

import { Categories } from './Categories.tsx'

describe('Categories', () => {
  beforeEach(() => {
    m.fetchCategories.mockResolvedValue([{ name: 'News', color: '#666', position: 1 }, { name: 'Games', color: '#fa0', position: 2 }])
    m.fetchSiteCategories.mockResolvedValue([{ kind: 'site', pattern: 'ynet.co.il', category: 'News', source: 'auto' }])
    m.fetchUncategorized.mockResolvedValue([{ kind: 'site', name: 'www.odd.example', ms: 600_000 }])
    m.setSiteCategory.mockResolvedValue(undefined)
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('sorts a site from the queue into a category', async () => {
    render(<Categories />)
    fireEvent.change(await screen.findByLabelText('Category for www.odd.example'), { target: { value: 'Games' } })
    await waitFor(() => expect(m.setSiteCategory).toHaveBeenCalledWith('site', 'odd.example', 'Games'))
  })

  it('adds a site typed by the parent', async () => {
    render(<Categories />)
    fireEvent.change(await screen.findByLabelText('Site or app'), { target: { value: 'https://www.news.example/today' } })
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'News' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(m.setSiteCategory).toHaveBeenCalledWith('site', 'news.example', 'News'))
  })
})
