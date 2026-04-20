import type { TimelineEvent } from '../../../shared/timelineEvent'

// Reducer for incoming TimelineEvent onto the currently-buffered events of a
// streaming tool_result message. Partial-stream kinds (tool_use_start,
// tool_use_progress, text_delta) are upgraded in-place when their terminal
// counterparts arrive, so the timeline never duplicates rows for the same
// underlying content block.
export function mergePartialEvent(prev: readonly TimelineEvent[], incoming: TimelineEvent): TimelineEvent[] {
  // tool_use_progress and terminal tool_use both collapse onto any prior
  // partial rows with the same id, anchored at the earliest such row's
  // position so the DOM element stays put across the upgrade chain
  // (start → progress → tool_use).
  if (incoming.kind === 'tool_use_progress' || incoming.kind === 'tool_use') {
    const { anchor, filtered } = stripPartialsForId(prev, incoming.id)
    if (anchor >= 0) {
      const next = filtered.slice()
      next.splice(anchor, 0, incoming)
      return next
    }
    return [...prev, incoming]
  }

  // text_delta coalesces with the immediately-preceding text_delta of the same block.
  if (incoming.kind === 'text_delta') {
    const last = prev[prev.length - 1]
    if (last?.kind === 'text_delta' && last.blockKey === incoming.blockKey) {
      const merged: TimelineEvent = {
        kind: 'text_delta',
        blockKey: incoming.blockKey,
        text: last.text + incoming.text,
        ts: incoming.ts
      }
      const next = prev.slice(0, -1)
      next.push(merged)
      return next
    }
    return [...prev, incoming]
  }

  // Terminal assistant_text replaces the trailing text_delta bubble if present.
  if (incoming.kind === 'assistant_text') {
    const last = prev[prev.length - 1]
    if (last?.kind === 'text_delta') {
      const next = prev.slice(0, -1)
      next.push(incoming)
      return next
    }
    return [...prev, incoming]
  }

  return [...prev, incoming]
}

function stripPartialsForId(
  prev: readonly TimelineEvent[],
  id: string
): { anchor: number; filtered: TimelineEvent[] } {
  let anchor = -1
  const filtered: TimelineEvent[] = []
  for (const ev of prev) {
    const isMatch =
      (ev.kind === 'tool_use_start' || ev.kind === 'tool_use_progress') && ev.id === id
    if (isMatch) {
      if (anchor === -1) anchor = filtered.length
      continue
    }
    filtered.push(ev)
  }
  return { anchor, filtered }
}
