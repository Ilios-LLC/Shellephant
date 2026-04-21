import { getTelegramBotToken, getTelegramChatId, getTelegramEnabled } from './settingsService'

export async function sendTelegramAlert(windowName: string): Promise<void> {
  try {
    if (!getTelegramEnabled()) return
    const token = getTelegramBotToken()
    const chatId = getTelegramChatId()
    if (!token || !chatId) return

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: `${windowName} needs attention` })
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`Telegram alert failed: ${res.status} ${res.statusText} ${body}`)
    }
  } catch (err) {
    console.error('Telegram alert error:', err)
  }
}
