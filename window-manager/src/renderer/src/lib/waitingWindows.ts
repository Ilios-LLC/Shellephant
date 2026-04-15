import { writable } from 'svelte/store'

export interface WaitingEntry {
  containerId: string
  windowId: number
  windowName: string
  projectId: number
  projectName: string
}

function createWaitingWindowsStore() {
  const { subscribe, update, set } = writable<WaitingEntry[]>([])

  return {
    subscribe,
    add(entry: WaitingEntry): void {
      update((list) => {
        const filtered = list.filter((e) => e.containerId !== entry.containerId)
        return [...filtered, entry]
      })
    },
    remove(containerId: string): void {
      update((list) => list.filter((e) => e.containerId !== containerId))
    },
    _resetForTest(): void {
      set([])
    }
  }
}

export const waitingWindows = createWaitingWindowsStore()
