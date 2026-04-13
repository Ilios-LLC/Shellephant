import { describe, it, expect } from 'vitest'
import { isValidSshUrl, extractRepoName, sshUrlToHttps } from '../../src/main/gitUrl'

describe('isValidSshUrl', () => {
  it('accepts git@github.com:org/repo.git', () => {
    expect(isValidSshUrl('git@github.com:org/repo.git')).toBe(true)
  })

  it('accepts git@github.com:org/repo without .git suffix', () => {
    expect(isValidSshUrl('git@github.com:org/repo')).toBe(true)
  })

  it('accepts git@gitlab.com:org/repo.git', () => {
    expect(isValidSshUrl('git@gitlab.com:org/repo.git')).toBe(true)
  })

  it('accepts git@bitbucket.org:org/repo.git', () => {
    expect(isValidSshUrl('git@bitbucket.org:org/repo.git')).toBe(true)
  })

  it('accepts nested paths like git@github.com:org/sub/repo.git', () => {
    expect(isValidSshUrl('git@github.com:org/sub/repo.git')).toBe(true)
  })

  it('rejects HTTPS URLs', () => {
    expect(isValidSshUrl('https://github.com/org/repo.git')).toBe(false)
  })

  it('rejects HTTP URLs', () => {
    expect(isValidSshUrl('http://github.com/org/repo.git')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidSshUrl('')).toBe(false)
  })

  it('rejects random text', () => {
    expect(isValidSshUrl('not a url at all')).toBe(false)
  })

  it('rejects URLs missing the colon separator', () => {
    expect(isValidSshUrl('git@github.com/org/repo.git')).toBe(false)
  })
})

describe('extractRepoName', () => {
  it('extracts repo name from git@github.com:org/repo.git', () => {
    expect(extractRepoName('git@github.com:org/repo.git')).toBe('repo')
  })

  it('extracts repo name without .git suffix', () => {
    expect(extractRepoName('git@github.com:org/repo')).toBe('repo')
  })

  it('extracts repo name from nested path', () => {
    expect(extractRepoName('git@github.com:org/sub/repo.git')).toBe('repo')
  })
})

describe('sshUrlToHttps', () => {
  it('converts git@github.com:org/repo.git to https URL with PAT', () => {
    expect(sshUrlToHttps('git@github.com:org/repo.git', 'mytoken')).toBe(
      'https://mytoken@github.com/org/repo.git'
    )
  })

  it('converts git@gitlab.com:org/repo to https URL with PAT', () => {
    expect(sshUrlToHttps('git@gitlab.com:org/repo', 'tok123')).toBe(
      'https://tok123@gitlab.com/org/repo'
    )
  })
})
