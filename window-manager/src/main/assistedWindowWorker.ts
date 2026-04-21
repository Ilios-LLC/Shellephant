import { parentPort } from 'worker_threads'
import { streamText, tool, jsonSchema } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import type { TimelineEvent } from '../shared/timelineEvent'
import { DEFAULT_KIMI_SYSTEM_PROMPT } from '../shared/defaultKimiPrompt'
import { runClaudeCode } from './claudeRunner'
import { writeEvent, type LogEvent } from './logWriter'
import { createMcpClient, DEFAULT_MCP_SERVERS, type McpClient } from './mcpManager'

// ─── Exported helpers (still tested directly) ────────────────────────────────

export function resolveSystemPrompt(
  projectPrompt: string | null,
  globalPrompt: string | null
): string {
  return projectPrompt ?? globalPrompt ?? DEFAULT_KIMI_SYSTEM_PROMPT
}

export function parseDockerOutput(
  stdout: string,
  stderr: string
): { outputLines: string[]; sessionId: string | null } {
  const outputLines = stdout.split('\n').filter(l => l.trim())
  const sessionId = stderr.trim() || null
  return { outputLines, sessionId }
}

// ─── MCP client — persistent per worker thread ───────────────────────────────

let mcpClient: McpClient | null = null
let mcpInitialized = false

export function __resetMcpForTests(): void {
  mcpClient = null
  mcpInitialized = false
}

async function ensureMcpClient(): Promise<McpClient | null> {
  if (mcpInitialized) return mcpClient
  mcpInitialized = true
  mcpClient = await createMcpClient(DEFAULT_MCP_SERVERS)
  return mcpClient
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function makeEmitter(
  turnId: string,
  logPath: string,
  windowId: number
): (eventType: string, payload?: Record<string, unknown>) => void {
  return function emitEvent(eventType: string, payload?: Record<string, unknown>): void {
    const event: LogEvent = { turnId, windowId, eventType, ts: Date.now(), payload }
    writeEvent(logPath, event)
    parentPort?.postMessage({ type: 'log-event', event })
  }
}

async function handleRunClaudeCode(
  windowId: number,
  containerId: string,
  message: string,
  sessionRef: { value: string | null },
  turnId: string,
  logPath: string
): Promise<string> {
  parentPort?.postMessage({ type: 'save-message', windowId, role: 'tool_call', content: message, metadata: JSON.stringify({ tool_name: 'run_claude_code' }) })

  const emitEvent = makeEmitter(turnId, logPath, windowId)
  let output: string
  let assistantText = ''
  let events: TimelineEvent[] = []

  try {
    const result = await runClaudeCode(containerId, sessionRef.value, message, {
      eventType: 'claude-to-shellephant:event',
      onExecEvent: (type, payload) => emitEvent(type, payload)
    })
    output = result.output
    assistantText = result.assistantText
    events = result.events
    sessionRef.value = result.newSessionId ?? sessionRef.value
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    output = `ERROR: ${errMsg}`
    const errorEvent: TimelineEvent = { kind: 'result', text: output, isError: true, ts: Date.now() }
    events = [errorEvent]
    parentPort?.postMessage({ type: 'claude-to-shellephant:event', event: errorEvent })
  }

  parentPort?.postMessage({
    type: 'save-message', windowId, role: 'claude-to-shellephant',
    content: assistantText || output,
    metadata: JSON.stringify({
      schemaVersion: 1, session_id: sessionRef.value, complete: true,
      tool_name: 'run_claude_code', events
    })
  })
  parentPort?.postMessage({ type: 'claude-to-shellephant:turn-complete', windowId })
  return output
}

// ─── Main turn function ───────────────────────────────────────────────────────

type StreamTurnData = {
  windowId: number
  containerId: string
  message: string
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
  initialSessionId?: string | null
  systemPrompt: string
  fireworksKey: string
  turnId: string
  logPath: string
}

async function streamTurn(data: StreamTurnData): Promise<void> {
  const { windowId, containerId, message, conversationHistory, initialSessionId, systemPrompt, fireworksKey, turnId, logPath } = data

  const emitEvent = makeEmitter(turnId, logPath, windowId)
  emitEvent('turn_start')

  const sessionRef = { value: initialSessionId ?? null }

  const mcp = await ensureMcpClient()
  const mcpTools = mcp ? await mcp.tools() : {}

  const runClaudeCodeTool = tool({
    description: 'Send a message to Claude Code inside the container. The session is managed automatically — every call continues the same CC conversation.',
    parameters: jsonSchema<{ message: string }>({
      type: 'object',
      properties: { message: { type: 'string', description: 'The task or message for Claude Code' } },
      required: ['message']
    }),
    execute: async ({ message: toolMessage }: { message: string }) => {
      return handleRunClaudeCode(windowId, containerId, toolMessage, sessionRef, turnId, logPath)
    }
  })

  const model = createOpenAI({
    baseURL: 'https://api.fireworks.ai/inference/v1',
    apiKey: fireworksKey
  })('accounts/fireworks/models/kimi-k2p5')

  parentPort?.postMessage({ type: 'save-message', windowId, role: 'user', content: message, metadata: null })

  const result = streamText({
    model,
    system: systemPrompt,
    messages: [...conversationHistory, { role: 'user' as const, content: message }],
    tools: { run_claude_code: runClaudeCodeTool, ...mcpTools },
    maxSteps: 20
  })

  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      parentPort?.postMessage({ type: 'kimi-delta', windowId, delta: part.textDelta })
    } else if (part.type === 'tool-call' && part.toolName === 'run_claude_code') {
      parentPort?.postMessage({
        type: 'tool-call', windowId,
        toolName: 'run_claude_code',
        message: (part.args as { message: string }).message
      })
    }
  }

  const steps = await result.steps
  const finalText = (steps[steps.length - 1]?.text ?? '').trim()
  const usage = await result.usage

  if (finalText) {
    parentPort?.postMessage({
      type: 'save-message', windowId, role: 'shellephant', content: finalText,
      metadata: JSON.stringify({ input_tokens: usage.promptTokens, output_tokens: usage.completionTokens })
    })
  }

  const costUsd = (usage.promptTokens * 0.000001) + (usage.completionTokens * 0.000003)
  emitEvent('turn_end')
  parentPort?.postMessage({
    type: 'turn-complete', windowId,
    stats: { inputTokens: usage.promptTokens, outputTokens: usage.completionTokens, costUsd },
    assistantText: finalText
  })
}

// ─── Message handler ──────────────────────────────────────────────────────────

parentPort?.on('message', async (msg: { type: string } & Record<string, unknown>) => {
  if (msg.type === 'cancel') {
    mcpClient?.close().catch(() => { /* best-effort */ })
    return
  }

  if (msg.type === 'send') {
    const data = msg as unknown as StreamTurnData
    try {
      await streamTurn(data)
    } catch (err) {
      if (data.turnId && data.logPath) {
        const event: LogEvent = {
          turnId: data.turnId, windowId: data.windowId,
          eventType: 'error', ts: Date.now(),
          payload: { error: err instanceof Error ? err.message : String(err) }
        }
        writeEvent(data.logPath, event)
        parentPort?.postMessage({ type: 'log-event', event })
      }
      parentPort?.postMessage({
        type: 'turn-complete', windowId: data.windowId,
        stats: null,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }
})
