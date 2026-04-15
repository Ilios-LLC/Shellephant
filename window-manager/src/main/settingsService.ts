import { safeStorage } from 'electron'
import { getDb } from './db'
import { invalidateIdentity } from './githubIdentity'

const PAT_KEY = 'github_pat'
const CLAUDE_KEY = 'claude_oauth_token'

export interface TokenStatus {
  configured: boolean
  hint: string | null
}

function readRow(key: string): Buffer | null {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: Buffer } | undefined
  return row?.value ?? null
}

function writeRow(key: string, value: Buffer): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
    .run(key, value)
}

function deleteRow(key: string): void {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(key)
}

function getSecret(key: string): string | null {
  const cipher = readRow(key)
  if (!cipher) return null
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Stored secret cannot be decrypted: OS secure storage unavailable')
  }
  // Ciphertext is bound to the OS keychain entry for this app. If the app is
  // renamed (or the keychain entry is removed/rotated), decryption fails
  // permanently. Drop the unreadable row so the user is prompted to re-enter
  // the secret instead of seeing repeated decrypt errors.
  try {
    return safeStorage.decryptString(cipher)
  } catch {
    deleteRow(key)
    return null
  }
}

function setSecret(key: string, value: string): void {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Token must not be empty')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Cannot store token: OS secure storage unavailable')
  }
  writeRow(key, safeStorage.encryptString(trimmed))
}

function statusFor(key: string): TokenStatus {
  const value = getSecret(key)
  if (!value) return { configured: false, hint: null }
  const hint = value.length >= 4 ? value.slice(-4) : null
  return { configured: true, hint }
}

export function getGitHubPat(): string | null {
  return getSecret(PAT_KEY)
}

export function getGitHubPatStatus(): TokenStatus {
  return statusFor(PAT_KEY)
}

export function setGitHubPat(pat: string): void {
  setSecret(PAT_KEY, pat)
  invalidateIdentity()
}

export function clearGitHubPat(): void {
  deleteRow(PAT_KEY)
  invalidateIdentity()
}

export function getClaudeToken(): string | null {
  return getSecret(CLAUDE_KEY)
}

export function getClaudeTokenStatus(): TokenStatus {
  return statusFor(CLAUDE_KEY)
}

export function setClaudeToken(token: string): void {
  setSecret(CLAUDE_KEY, token)
}

export function clearClaudeToken(): void {
  deleteRow(CLAUDE_KEY)
}
