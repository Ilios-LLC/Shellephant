// Maps persisted `assisted_messages` rows to entries the Kimi loop can safely
// replay as OpenAI chat messages.
//
// DB roles include `tool_call`, `tool_result`, and `ping_user` — none of which
// are valid OpenAI chat roles. Replaying them raw corrupts the context on
// turn 2+. We collapse everything to `user` / `assistant` plain-text messages,
// accepting a lossy round-trip in exchange for a schema that stays valid.
// The `tool_call_id` linkage is intentionally dropped because we don't
// persist it; without it, a real `tool` role message would fail validation.

export type ChatHistoryEntry = {
  role: 'user' | 'assistant'
  content: string
}

export function mapDbRowToHistoryEntry(role: string, content: string): ChatHistoryEntry | null {
  switch (role) {
    case 'user':
      return { role: 'user', content }
    case 'assistant':
      return { role: 'assistant', content }
    case 'tool_call':
      return { role: 'assistant', content: `(called run_claude_code: ${content})` }
    case 'tool_result':
      return { role: 'user', content: `CC output: ${content}` }
    case 'ping_user':
      return { role: 'assistant', content: `(asked user: ${content})` }
    default:
      return null
  }
}
