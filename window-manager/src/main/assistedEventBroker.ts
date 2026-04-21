import { EventEmitter } from 'events'

type Listener = (channel: string, args: unknown[]) => void

const emitter = new EventEmitter()
emitter.setMaxListeners(0)

function topic(windowId: number): string {
  return `w:${windowId}`
}

export function publish(windowId: number, channel: string, args: unknown[]): void {
  emitter.emit(topic(windowId), channel, args)
}

export function subscribe(windowId: number, listener: Listener): () => void {
  emitter.on(topic(windowId), listener)
  return () => emitter.off(topic(windowId), listener)
}

export function __resetForTests(): void {
  emitter.removeAllListeners()
}
