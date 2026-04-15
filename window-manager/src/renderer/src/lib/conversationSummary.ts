import { writable } from 'svelte/store'

export interface ConversationSummary {
  title: string
  bullets: string[]
}

function createConversationSummaryStore() {
  const { subscribe, update, set } = writable<Map<string, ConversationSummary>>(new Map())

  return {
    subscribe,
    set(containerId: string, summary: ConversationSummary): void {
      update((m) => {
        m.set(containerId, summary)
        return new Map(m)
      })
    },
    remove(containerId: string): void {
      update((m) => {
        m.delete(containerId)
        return new Map(m)
      })
    },
    _resetForTest(): void {
      set(new Map())
    }
  }
}

export const conversationSummary = createConversationSummaryStore()
