import { writable } from 'svelte/store'

/** Set to a windowId to request focus on that window's chat textarea. Consumers reset to null after handling. */
export const chatFocusSignal = writable<number | null>(null)
