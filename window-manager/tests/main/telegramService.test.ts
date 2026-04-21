import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mockGetEnabled = vi.fn()
const mockGetToken = vi.fn()
const mockGetChatId = vi.fn()

vi.mock('../../src/main/settingsService', () => ({
  getTelegramEnabled: () => mockGetEnabled(),
  getTelegramBotToken: () => mockGetToken(),
  getTelegramChatId: () => mockGetChatId()
}))

import { sendTelegramAlert } from '../../src/main/telegramService'

describe('sendTelegramAlert', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' })
    vi.stubGlobal('fetch', fetchMock)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    errorSpy.mockRestore()
  })

  it('does nothing when disabled', async () => {
    mockGetEnabled.mockReturnValue(false)
    mockGetToken.mockReturnValue('t')
    mockGetChatId.mockReturnValue('c')
    await sendTelegramAlert('window-a')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing when token missing', async () => {
    mockGetEnabled.mockReturnValue(true)
    mockGetToken.mockReturnValue(null)
    mockGetChatId.mockReturnValue('c')
    await sendTelegramAlert('window-a')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing when chat ID missing', async () => {
    mockGetEnabled.mockReturnValue(true)
    mockGetToken.mockReturnValue('t')
    mockGetChatId.mockReturnValue(null)
    await sendTelegramAlert('window-a')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts to Telegram API when fully configured', async () => {
    mockGetEnabled.mockReturnValue(true)
    mockGetToken.mockReturnValue('BOT123')
    mockGetChatId.mockReturnValue('789')
    await sendTelegramAlert('my-window')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/botBOT123/sendMessage',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: '789', text: 'my-window needs attention' })
      })
    )
  })

  it('logs when API returns non-ok status but does not throw', async () => {
    mockGetEnabled.mockReturnValue(true)
    mockGetToken.mockReturnValue('t')
    mockGetChatId.mockReturnValue('c')
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' })
    await expect(sendTelegramAlert('w')).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()
  })

  it('swallows fetch errors', async () => {
    mockGetEnabled.mockReturnValue(true)
    mockGetToken.mockReturnValue('t')
    mockGetChatId.mockReturnValue('c')
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    await expect(sendTelegramAlert('w')).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()
  })
})
