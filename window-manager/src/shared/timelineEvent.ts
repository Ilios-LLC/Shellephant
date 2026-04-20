// Shared discriminated union for Claude Agent SDK timeline events.
// Consumed by main (worker, filter), preload (IPC types), and renderer (UI).

export type TimelineEvent =
  | { kind: 'session_init'; model: string; sessionId: string | null; ts: number }
  | { kind: 'hook'; name: string; status: 'started' | 'ok' | 'failed'; exitCode?: number; ts: number }
  | { kind: 'thinking'; text: string; ts: number }
  | { kind: 'assistant_text'; text: string; ts: number }
  | {
      kind: 'tool_use'
      id: string
      name: string
      input: Record<string, unknown>
      summary: string
      ts: number
    }
  | { kind: 'tool_result'; toolUseId: string; text: string; isError: boolean; ts: number }
  | { kind: 'result'; text: string; isError: boolean; ts: number }
  // Partial-stream kinds — ephemeral, never persisted. Emitted while the model
  // is still typing a content block; replaced in-place by their terminal
  // counterparts (`tool_use`, `assistant_text`) when the assistant message
  // finalizes.
  | { kind: 'tool_use_start'; id: string; name: string; ts: number }
  | { kind: 'tool_use_progress'; id: string; name: string; summary: string; bytesSeen: number; ts: number }
  | { kind: 'text_delta'; blockKey: string; text: string; ts: number }

export type TimelineMetadata = {
  schemaVersion: 1
  events: TimelineEvent[]
  tool_name?: string
  session_id?: string | null
  complete?: boolean
}

export function isTimelineMetadata(value: unknown): value is TimelineMetadata {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return v.schemaVersion === 1 && Array.isArray(v.events)
}
