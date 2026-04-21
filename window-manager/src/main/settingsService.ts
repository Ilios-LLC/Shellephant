import { safeStorage } from 'electron'
import { getDb } from './db'
import { invalidateIdentity, getIdentity } from './githubIdentity'
import { applyGitIdentity } from './gitOps'

const PAT_KEY = 'github_pat'
const CLAUDE_KEY = 'claude_oauth_token'
const FIREWORKS_KEY = 'fireworks_api_key'
const KIMI_PROMPT_KEY = 'kimi_system_prompt'
const TELEGRAM_TOKEN_KEY = 'telegram_bot_token'
const TELEGRAM_CHAT_ID_KEY = 'telegram_chat_id'
const TELEGRAM_ENABLED_KEY = 'telegram_enabled'
const PHONE_ENDPOINT_KEY = 'phone_endpoint'

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
  getIdentity(pat)
    .then(({ name, email }) => applyGitIdentity(name, email))
    .catch((err) => console.error('Failed to apply git identity after PAT save:', err))
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

function getPlainSetting(key: string): string | null {
  const row = readRow(key)
  if (!row) return null
  return row.toString('utf8')
}

function setPlainSetting(key: string, value: string): void {
  writeRow(key, Buffer.from(value, 'utf8'))
}

export function getFireworksKey(): string | null {
  return getSecret(FIREWORKS_KEY)
}

export function getFireworksKeyStatus(): TokenStatus {
  return statusFor(FIREWORKS_KEY)
}

export function setFireworksKey(key: string): void {
  setSecret(FIREWORKS_KEY, key)
}

export function clearFireworksKey(): void {
  deleteRow(FIREWORKS_KEY)
}

export function getTelegramBotToken(): string | null {
  return getSecret(TELEGRAM_TOKEN_KEY)
}

export function getTelegramBotTokenStatus(): TokenStatus {
  return statusFor(TELEGRAM_TOKEN_KEY)
}

export function setTelegramBotToken(token: string): void {
  setSecret(TELEGRAM_TOKEN_KEY, token)
}

export function clearTelegramBotToken(): void {
  deleteRow(TELEGRAM_TOKEN_KEY)
}

export function getTelegramChatId(): string | null {
  return getPlainSetting(TELEGRAM_CHAT_ID_KEY)
}

export function setTelegramChatId(chatId: string): void {
  const trimmed = chatId.trim()
  if (!trimmed) throw new Error('Chat ID must not be empty')
  setPlainSetting(TELEGRAM_CHAT_ID_KEY, trimmed)
}

export function clearTelegramChatId(): void {
  deleteRow(TELEGRAM_CHAT_ID_KEY)
}

export function getTelegramEnabled(): boolean {
  return getPlainSetting(TELEGRAM_ENABLED_KEY) === '1'
}

export function setTelegramEnabled(enabled: boolean): void {
  setPlainSetting(TELEGRAM_ENABLED_KEY, enabled ? '1' : '0')
}

export interface TelegramStatus {
  token: TokenStatus
  chatId: string | null
  enabled: boolean
}

export function getTelegramStatus(): TelegramStatus {
  return {
    token: getTelegramBotTokenStatus(),
    chatId: getTelegramChatId(),
    enabled: getTelegramEnabled()
  }
}

export function getPhoneEndpoint(): string | null {
  return getPlainSetting(PHONE_ENDPOINT_KEY)
}

export function setPhoneEndpoint(endpoint: string): void {
  const trimmed = endpoint.trim()
  if (!trimmed) {
    deleteRow(PHONE_ENDPOINT_KEY)
    return
  }
  setPlainSetting(PHONE_ENDPOINT_KEY, trimmed)
}

export function clearPhoneEndpoint(): void {
  deleteRow(PHONE_ENDPOINT_KEY)
}

export function getKimiSystemPrompt(): string | null {
  return getPlainSetting(KIMI_PROMPT_KEY)
}

export function setKimiSystemPrompt(prompt: string): void {
  // Empty/whitespace clears the override so the default or project-level prompt takes effect.
  if (!prompt.trim()) {
    deleteRow(KIMI_PROMPT_KEY)
    return
  }
  setPlainSetting(KIMI_PROMPT_KEY, prompt)
}
