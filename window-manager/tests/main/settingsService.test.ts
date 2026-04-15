import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initDb, closeDb, getDb } from '../../src/main/db'

const mockIsAvailable = vi.fn().mockReturnValue(true)
const mockEncrypt = vi.fn((s: string) => Buffer.from(`enc:${s}`, 'utf8'))
const mockDecrypt = vi.fn((buf: Buffer) => buf.toString('utf8').replace(/^enc:/, ''))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => mockIsAvailable(),
    encryptString: (s: string) => mockEncrypt(s),
    decryptString: (b: Buffer) => mockDecrypt(b)
  }
}))

const mockInvalidateIdentity = vi.fn()
const mockGetIdentity = vi.fn().mockResolvedValue({ name: 'Test User', email: 'test@example.com' })
const mockApplyGitIdentity = vi.fn().mockResolvedValue(undefined)
vi.mock('../../src/main/githubIdentity', () => ({
  invalidateIdentity: () => mockInvalidateIdentity(),
  getIdentity: (pat: string) => mockGetIdentity(pat)
}))
vi.mock('../../src/main/gitOps', () => ({
  applyGitIdentity: (name: string, email: string) => mockApplyGitIdentity(name, email)
}))

import {
  getGitHubPat,
  getGitHubPatStatus,
  setGitHubPat,
  clearGitHubPat,
  getClaudeToken,
  getClaudeTokenStatus,
  setClaudeToken,
  clearClaudeToken
} from '../../src/main/settingsService'

describe('settingsService', () => {
  beforeEach(() => {
    initDb(':memory:')
    vi.clearAllMocks()
    mockIsAvailable.mockReturnValue(true)
  })

  afterEach(() => {
    closeDb()
  })

  describe('GitHub PAT', () => {
    it('getGitHubPatStatus returns unconfigured when nothing is stored', () => {
      expect(getGitHubPatStatus()).toEqual({ configured: false, hint: null })
    })

    it('setGitHubPat encrypts via safeStorage and persists ciphertext', () => {
      setGitHubPat('ghp_abcdefgh')
      expect(mockEncrypt).toHaveBeenCalledWith('ghp_abcdefgh')
      const row = getDb()
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get('github_pat') as { value: Buffer }
      expect(row.value.toString('utf8')).toBe('enc:ghp_abcdefgh')
    })

    it('getGitHubPat round-trips through decryptString', () => {
      setGitHubPat('ghp_abcdefgh')
      expect(getGitHubPat()).toBe('ghp_abcdefgh')
    })

    it('getGitHubPatStatus exposes only last 4 chars, never plaintext', () => {
      setGitHubPat('ghp_abcdefgh')
      expect(getGitHubPatStatus()).toEqual({ configured: true, hint: 'efgh' })
    })

    it('setGitHubPat rejects whitespace-only input', () => {
      expect(() => setGitHubPat('   ')).toThrow(/must not be empty/i)
    })

    it('setGitHubPat throws when safeStorage is unavailable', () => {
      mockIsAvailable.mockReturnValue(false)
      expect(() => setGitHubPat('ghp_abcdefgh')).toThrow(/secure storage unavailable/i)
    })

    it('getGitHubPat throws when safeStorage becomes unavailable after storing', () => {
      setGitHubPat('ghp_abcdefgh')
      mockIsAvailable.mockReturnValue(false)
      expect(() => getGitHubPat()).toThrow(/secure storage unavailable/i)
    })

    it('returns null and drops the row when decryption fails (e.g. after rename)', () => {
      setGitHubPat('ghp_abcdefgh')
      mockDecrypt.mockImplementationOnce(() => {
        throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
      })
      expect(getGitHubPat()).toBeNull()
      expect(getGitHubPatStatus()).toEqual({ configured: false, hint: null })
      const row = getDb()
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get('github_pat')
      expect(row).toBeUndefined()
    })

    it('setGitHubPat replaces an existing PAT', () => {
      setGitHubPat('ghp_aaaaaaaaaa')
      setGitHubPat('ghp_bbbbbbbbbb')
      expect(getGitHubPat()).toBe('ghp_bbbbbbbbbb')
      const rows = getDb()
        .prepare("SELECT key FROM settings WHERE key = 'github_pat'")
        .all() as { key: string }[]
      expect(rows).toHaveLength(1)
    })

    it('clearGitHubPat removes the row', () => {
      setGitHubPat('ghp_abcdefgh')
      clearGitHubPat()
      expect(getGitHubPatStatus()).toEqual({ configured: false, hint: null })
      const row = getDb()
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get('github_pat')
      expect(row).toBeUndefined()
    })

    it('clearGitHubPat is idempotent', () => {
      expect(() => clearGitHubPat()).not.toThrow()
      expect(() => clearGitHubPat()).not.toThrow()
    })

    it('invalidates the cached GitHub identity on setGitHubPat', () => {
      setGitHubPat('ghp_abcdefgh')
      expect(mockInvalidateIdentity).toHaveBeenCalledTimes(1)
    })

    it('invalidates the cached GitHub identity on clearGitHubPat', () => {
      setGitHubPat('ghp_abcdefgh')
      mockInvalidateIdentity.mockClear()
      clearGitHubPat()
      expect(mockInvalidateIdentity).toHaveBeenCalledTimes(1)
    })
  })

  describe('Claude token', () => {
    it('getClaudeTokenStatus returns unconfigured when nothing is stored', () => {
      expect(getClaudeTokenStatus()).toEqual({ configured: false, hint: null })
    })

    it('setClaudeToken encrypts and persists under claude_oauth_token key', () => {
      setClaudeToken('sk-ant-01234567')
      const row = getDb()
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get('claude_oauth_token') as { value: Buffer }
      expect(row.value.toString('utf8')).toBe('enc:sk-ant-01234567')
    })

    it('getClaudeToken round-trips', () => {
      setClaudeToken('sk-ant-01234567')
      expect(getClaudeToken()).toBe('sk-ant-01234567')
    })

    it('getClaudeTokenStatus exposes only last 4 chars', () => {
      setClaudeToken('sk-ant-01234567')
      expect(getClaudeTokenStatus()).toEqual({ configured: true, hint: '4567' })
    })

    it('clearClaudeToken removes the row', () => {
      setClaudeToken('sk-ant-01234567')
      clearClaudeToken()
      expect(getClaudeTokenStatus()).toEqual({ configured: false, hint: null })
    })

    it('does NOT invalidate the GitHub identity on Claude-token ops', () => {
      setClaudeToken('sk-ant-01234567')
      clearClaudeToken()
      expect(mockInvalidateIdentity).not.toHaveBeenCalled()
    })
  })

  it('PAT and Claude token are stored independently', () => {
    setGitHubPat('ghp_abcdefgh')
    setClaudeToken('sk-ant-01234567')
    expect(getGitHubPat()).toBe('ghp_abcdefgh')
    expect(getClaudeToken()).toBe('sk-ant-01234567')

    clearGitHubPat()
    expect(getGitHubPat()).toBeNull()
    expect(getClaudeToken()).toBe('sk-ant-01234567')
  })
})
