import { experimental_createMCPClient } from 'ai'
import { Experimental_StdioMCPTransport } from 'ai/mcp-stdio'
import type { ToolSet } from 'ai'

export type McpServerConfig = {
  command: string
  args: string[]
  env?: Record<string, string>
}

export type McpClient = {
  tools(): Promise<ToolSet>
  close(): Promise<void>
}

export const DEFAULT_MCP_SERVERS: McpServerConfig[] = [
  { command: 'npx', args: ['@playwright/mcp@latest'] }
]

export async function createMcpClient(servers: McpServerConfig[]): Promise<McpClient | null> {
  if (servers.length === 0) return null

  const clients: Array<{ tools(): Promise<ToolSet>; close(): Promise<void> }> = []

  try {
    for (const server of servers) {
      const transport = new Experimental_StdioMCPTransport({
        command: server.command,
        args: server.args,
        ...(server.env ? { env: server.env } : {})
      })
      const client = await experimental_createMCPClient({ transport })
      clients.push(client)
    }

    return {
      tools: async () => {
        const toolSets = await Promise.all(clients.map(c => c.tools()))
        const allKeys = toolSets.flatMap(ts => Object.keys(ts))
        const seen = new Set<string>()
        for (const key of allKeys) {
          if (seen.has(key)) console.warn(`[mcpManager] tool name collision: "${key}" — last server wins`)
          seen.add(key)
        }
        return Object.assign({}, ...toolSets) as ToolSet
      },
      close: async () => {
        await Promise.all(clients.map(c => c.close()))
      }
    }
  } catch (err) {
    console.error('[mcpManager] init failed:', err instanceof Error ? err.message : String(err))
    await Promise.allSettled(clients.map(c => c.close()))
    return null
  }
}
