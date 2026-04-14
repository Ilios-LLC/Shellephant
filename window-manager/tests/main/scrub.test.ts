import { describe, it, expect } from 'vitest'
import { scrubPat } from '../../src/main/scrub'

describe('scrubPat', () => {
  it('replaces the PAT with *** everywhere it appears', () => {
    const pat = 'ghp_deadbeef'
    const input = `remote: https://${pat}@github.com/foo/bar.git\nerror token ${pat}`
    expect(scrubPat(input, pat)).toBe('remote: https://***@github.com/foo/bar.git\nerror token ***')
  })

  it('returns the input unchanged if the PAT is absent', () => {
    expect(scrubPat('hello world', 'ghp_x')).toBe('hello world')
  })

  it('is a no-op for empty or nullish PAT', () => {
    expect(scrubPat('hello ghp_x', '')).toBe('hello ghp_x')
    expect(scrubPat('hello', undefined as unknown as string)).toBe('hello')
  })

  it('escapes regex metacharacters inside the PAT', () => {
    const pat = 'a.b+c*'
    expect(scrubPat(`token=${pat} end`, pat)).toBe('token=*** end')
  })
})
