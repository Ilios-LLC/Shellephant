import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockTools, mockClose, mockCreateMcpClient, MockStdioTransport } = vi.hoisted(() => {
  const mockTools = vi.fn().mockResolvedValue({ screenshot: { execute: vi.fn() } })
  const mockClose = vi.fn().mockResolvedValue(undefined)
  const mockCreateMcpClient = vi.fn().mockResolvedValue({ tools: mockTools, close: mockClose })
  const MockStdioTransport = vi.fn()
  return { mockTools, mockClose, mockCreateMcpClient, MockStdioTransport }
})

vi.mock('ai', () => ({
  experimental_createMCPClient: mockCreateMcpClient
}))

vi.mock('ai/mcp-stdio', () => ({
  Experimental_StdioMCPTransport: MockStdioTransport
}))

import { createMcpClient } from '../../src/main/mcpManager'

describe('createMcpClient', () => {
  beforeEach(() => {
    mockCreateMcpClient.mockClear()
    mockTools.mockClear()
    mockClose.mockClear()
    MockStdioTransport.mockClear()
  })

  it('creates a client and fetches tools from a single server', async () => {
    const client = await createMcpClient([{ command: 'npx', args: ['@playwright/mcp@latest'] }])
    expect(client).not.toBeNull()
    const tools = await client!.tools()
    expect(tools).toHaveProperty('screenshot')
    expect(MockStdioTransport).toHaveBeenCalledWith({
      command: 'npx',
      args: ['@playwright/mcp@latest']
    })
  })

  it('merges tool sets from multiple servers into one flat object', async () => {
    mockTools
      .mockResolvedValueOnce({ screenshot: { execute: vi.fn() } })
      .mockResolvedValueOnce({ fetch: { execute: vi.fn() } })

    const client = await createMcpClient([
      { command: 'npx', args: ['@playwright/mcp@latest'] },
      { command: 'npx', args: ['@some/other-mcp@latest'] }
    ])
    expect(client).not.toBeNull()
    const tools = await client!.tools()
    expect(tools).toHaveProperty('screenshot')
    expect(tools).toHaveProperty('fetch')
  })

  it('calls close on all underlying clients when client.close() is called', async () => {
    const close1 = vi.fn().mockResolvedValue(undefined)
    const close2 = vi.fn().mockResolvedValue(undefined)
    mockCreateMcpClient
      .mockResolvedValueOnce({ tools: vi.fn().mockResolvedValue({}), close: close1 })
      .mockResolvedValueOnce({ tools: vi.fn().mockResolvedValue({}), close: close2 })

    const client = await createMcpClient([
      { command: 'npx', args: ['@playwright/mcp@latest'] },
      { command: 'npx', args: ['@other/mcp@latest'] }
    ])
    await client!.close()
    expect(close1).toHaveBeenCalledOnce()
    expect(close2).toHaveBeenCalledOnce()
  })

  it('returns null when client creation throws', async () => {
    mockCreateMcpClient.mockRejectedValueOnce(new Error('spawn ENOENT'))
    const client = await createMcpClient([{ command: 'npx', args: ['@playwright/mcp@latest'] }])
    expect(client).toBeNull()
  })

  it('returns null for empty servers array', async () => {
    const client = await createMcpClient([])
    expect(client).toBeNull()
    expect(mockCreateMcpClient).not.toHaveBeenCalled()
  })
})
