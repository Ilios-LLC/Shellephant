// Maps persisted `assisted_messages` rows to entries Shellephant can replay.
// New roles: shellephant, claude, claude-action.
// Legacy roles (assistant, tool_call, tool_result, ping_user) kept for backward compat.

export type ChatHistoryEntry = {
  role: 'user' | 'assistant'
  content: string
}

export function mapDbRowToHistoryEntry(role: string, content: string): ChatHistoryEntry | null {
  switch (role) {
    case 'user':
      return { role: 'user', content }
    case 'shellephant':
    case 'assistant': // legacy
      return { role: 'assistant', content }
    case 'tool_result': // legacy — treat as claude response
      return { role: 'user', content: `CC output: ${content}` }
    case 'claude':
    case 'claude-to-shellephant':
    case 'claude-action':
    case 'claude-to-shellephant-action':
    case 'tool_call': // legacy
    case 'ping_user': // legacy/removed
    default:
      return null
  }
}
