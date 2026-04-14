import { writable } from 'svelte/store'

export type ToastLevel = 'success' | 'error'

export interface Toast {
  id: number
  level: ToastLevel
  title: string
  body?: string
}

let nextId = 1
export const toasts = writable<Toast[]>([])

export function pushToast(t: Omit<Toast, 'id'>): number {
  const id = nextId++
  toasts.update((list) => [...list, { id, ...t }])
  return id
}

export function dismissToast(id: number): void {
  toasts.update((list) => list.filter((t) => t.id !== id))
}
