import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  getIdentity,
  invalidateIdentity,
  __resetForTests
} from '../../src/main/githubIdentity'

beforeEach(() => {
  mockFetch.mockReset()
  __resetForTests()
})

describe('getIdentity', () => {
  it('returns name + email from GET /user when both present', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 42, login: 'octo', name: 'Octo Cat', email: 'octo@example.com' })
    })
    const id = await getIdentity('PAT')
    expect(id).toEqual({ name: 'Octo Cat', email: 'octo@example.com' })
  })

  it('falls back to noreply email when /user email is null', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 42, login: 'octo', name: 'Octo Cat', email: null })
    })
    const id = await getIdentity('PAT')
    expect(id).toEqual({
      name: 'Octo Cat',
      email: '42+octo@users.noreply.github.com'
    })
  })

  it('falls back to login when name is null', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 42, login: 'octo', name: null, email: null })
    })
    const id = await getIdentity('PAT')
    expect(id.name).toBe('octo')
  })

  it('caches: second call does not refetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1, login: 'x', name: 'x', email: 'x@x' })
    })
    await getIdentity('PAT')
    await getIdentity('PAT')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('invalidateIdentity() clears the cache', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 1, login: 'x', name: 'x', email: 'x@x' })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 2, login: 'y', name: 'y', email: 'y@y' })
      })
    await getIdentity('PAT')
    invalidateIdentity()
    const second = await getIdentity('PAT')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(second.name).toBe('y')
  })

  it('throws a descriptive error on non-2xx', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' })
    await expect(getIdentity('PAT')).rejects.toThrow(/401/)
  })

  it('sends Authorization: Bearer <PAT> and GitHub API headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1, login: 'x', name: 'x', email: 'x@x' })
    })
    await getIdentity('my-pat-value')
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.github.com/user')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer my-pat-value',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    })
  })
})
