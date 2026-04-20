import { parentPort } from 'worker_threads'
import OpenAI from 'openai'
import type { TimelineEvent } from '../shared/timelineEvent'
import { DEFAULT_KIMI_SYSTEM_PROMPT } from '../shared/defaultKimiPrompt'
import { runClaudeCode } from './claudeRunner'

export function resolveSystemPrompt(
  projectPrompt: string | null,
  globalPrompt: string | null
): string {
  return projectPrompt ?? globalPrompt ?? DEFAULT_KIMI_SYSTEM_PROMPT
}

export function buildShellephantTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'run_claude_code',
        description: 'Send a message to Claude Code inside the container. The session is managed for you automatically — every call in this window continues the same CC conversation.',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'The task or message for Claude Code' }
          },
          required: ['message']
        }
      }
    }
  ]
}

export function parseDockerOutput(stdout: string, stderr: string): { outputLines: string[]; sessionId: string | null } {
  const outputLines = stdout.split('\n').filter(l => l.trim())
  const sessionId = stderr.trim() || null
  return { outputLines, sessionId }
}

type KimiLoopData = {
  windowId: number
  containerId: string
  message: string
  conversationHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  initialSessionId?: string | null
  systemPrompt: string
  fireworksKey: string
}

type ToolCallAccum = { id: string; name: string; arguments: string }

async function handleRunClaudeCode(
  windowId: number,
  containerId: string,
  tc: ToolCallAccum,
  activeSessionId: string | null
): Promise<{ toolResult: string; newActiveSessionId: string | null }> {
  // The tool schema no longer exposes session_id. Session state is owned by
  // this worker — seeded from DB at turn start, updated in-place as CC emits
  // session_final events. We intentionally ignore any session_id the model
  // tries to sneak in via tc.arguments; old persisted tool calls may still
  // carry the field, so we parse loosely.
  const args = JSON.parse(tc.arguments) as { message: string }
  parentPort?.postMessage({ type: 'tool-call', windowId, toolName: 'run_claude_code', message: args.message })
  parentPort?.postMessage({ type: 'save-message', windowId, role: 'tool_call', content: args.message, metadata: JSON.stringify({ tool_name: 'run_claude_code' }) })
  let output: string
  let assistantText = ''
  let events: TimelineEvent[] = []
  let newActiveSessionId = activeSessionId

  try {
    const result = await runClaudeCode(containerId, activeSessionId, args.message, { eventType: 'claude-to-shellephant:event' })
    output = result.output
    assistantText = result.assistantText
    events = result.events
    newActiveSessionId = result.newSessionId ?? activeSessionId
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    output = `ERROR: ${message}`
    // Surface the failure on the timeline so the UI shows *something* when a
    // docker exec fails — otherwise the tool_call bubble sits next to nothing.
    const errorEvent: TimelineEvent = { kind: 'result', text: output, isError: true, ts: Date.now() }
    events = [errorEvent]
    parentPort?.postMessage({ type: 'claude-to-shellephant:event', event: errorEvent })
  }

  parentPort?.postMessage({
    type: 'save-message', windowId, role: 'claude-to-shellephant', content: assistantText || output,
    metadata: JSON.stringify({
      schemaVersion: 1,
      session_id: newActiveSessionId,
      complete: true,
      tool_name: 'run_claude_code',
      events
    })
  })
  parentPort?.postMessage({ type: 'claude-to-shellephant:turn-complete', windowId })
  return { toolResult: output, newActiveSessionId }
}

async function processStreamChunk(
  chunk: OpenAI.Chat.Completions.ChatCompletionChunk,
  kimiDeltaRef: { value: string },
  toolCalls: ToolCallAccum[],
  currentIndexRef: { value: number },
  tokenRef: { input: number; output: number },
  windowId: number
): Promise<void> {
  const delta = chunk.choices[0]?.delta
  if (!delta) return

  if (delta.content) {
    kimiDeltaRef.value += delta.content
    parentPort?.postMessage({ type: 'kimi-delta', windowId, delta: delta.content })
  }

  if (delta.tool_calls) {
    for (const tc of delta.tool_calls) {
      if (tc.index !== undefined && tc.index !== currentIndexRef.value) {
        currentIndexRef.value = tc.index
        toolCalls[tc.index] = { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' }
      }
      if (tc.function?.arguments) toolCalls[currentIndexRef.value].arguments += tc.function.arguments
      if (tc.id) toolCalls[currentIndexRef.value].id = tc.id
      if (tc.function?.name) toolCalls[currentIndexRef.value].name = tc.function.name
    }
  }

  if (chunk.usage) {
    tokenRef.input += chunk.usage.prompt_tokens ?? 0
    tokenRef.output += chunk.usage.completion_tokens ?? 0
  }
}

async function kimiLoop(data: KimiLoopData): Promise<void> {
  const { windowId, containerId, message, conversationHistory, initialSessionId, systemPrompt, fireworksKey } = data

  const client = new OpenAI({ apiKey: fireworksKey, baseURL: 'https://api.fireworks.ai/inference/v1' })

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: message }
  ]

  parentPort?.postMessage({ type: 'save-message', windowId, role: 'user', content: message, metadata: null })

  let activeSessionId: string | null = initialSessionId ?? null
  let finalAssistantText = ''
  const tokenRef = { input: 0, output: 0 }

  while (true) {
    const kimiDeltaRef = { value: '' }
    const toolCalls: ToolCallAccum[] = []
    const currentIndexRef = { value: -1 }

    const stream = await client.chat.completions.create({
      model: 'accounts/fireworks/models/kimi-k2p5',
      messages,
      tools: buildShellephantTools(),
      stream: true
    })

    for await (const chunk of stream) {
      await processStreamChunk(chunk, kimiDeltaRef, toolCalls, currentIndexRef, tokenRef, windowId)
    }

    if (kimiDeltaRef.value) {
      messages.push({ role: 'assistant', content: kimiDeltaRef.value })
      parentPort?.postMessage({
        type: 'save-message', windowId, role: 'shellephant', content: kimiDeltaRef.value,
        metadata: JSON.stringify({ input_tokens: tokenRef.input, output_tokens: tokenRef.output })
      })
    }

    if (toolCalls.length === 0) {
      // The iteration that exits without tool calls is the one that carries
      // the user-facing text for this turn. Everything earlier is interstitial
      // commentary between tool calls.
      finalAssistantText = kimiDeltaRef.value
      break
    }

    messages.push({
      role: 'assistant',
      content: kimiDeltaRef.value || null,
      tool_calls: toolCalls.map(tc => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: tc.arguments } }))
    })

    let ranClaudeCodeThisTurn = false
    for (const tc of toolCalls) {
      let toolResult: string

      if (tc.name === 'run_claude_code') {
        if (ranClaudeCodeThisTurn) {
          toolResult = 'Deferred — only one run_claude_code allowed per turn. Re-plan after reading the previous response, then call run_claude_code again.'
        } else {
          const res = await handleRunClaudeCode(windowId, containerId, tc, activeSessionId)
          toolResult = res.toolResult
          activeSessionId = res.newActiveSessionId
          ranClaudeCodeThisTurn = true
        }
      } else {
        toolResult = 'Unknown tool'
      }

      messages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult })
    }
  }

  const costUsd = (tokenRef.input * 0.000001) + (tokenRef.output * 0.000003)
  parentPort?.postMessage({
    type: 'turn-complete', windowId,
    stats: { inputTokens: tokenRef.input, outputTokens: tokenRef.output, costUsd },
    assistantText: finalAssistantText.trim()
  })
}

parentPort?.on('message', async (msg: { type: string } & Record<string, unknown>) => {
  if (msg.type === 'send') {
    try {
      await kimiLoop(msg as unknown as KimiLoopData)
    } catch (err) {
      parentPort?.postMessage({
        type: 'turn-complete',
        windowId: (msg as { windowId: number }).windowId,
        stats: null,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }
})
