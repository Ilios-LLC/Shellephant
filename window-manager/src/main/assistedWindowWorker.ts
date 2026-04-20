import { parentPort } from 'worker_threads'
import { spawn } from 'child_process'
import OpenAI from 'openai'

const DEFAULT_SYSTEM_PROMPT = `You are an autonomous coding assistant orchestrating a Claude Code session inside a development container.
Use run_claude_code to execute coding tasks. Use ping_user only when you genuinely cannot proceed without human input — prefer to resolve ambiguity yourself.
When the task is complete, summarize what was accomplished.`

export function resolveSystemPrompt(
  projectPrompt: string | null,
  globalPrompt: string | null
): string {
  return projectPrompt ?? globalPrompt ?? DEFAULT_SYSTEM_PROMPT
}

export function buildKimiTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'run_claude_code',
        description: 'Send a message to the Claude Code SDK session inside the container. Pass null session_id to start a new session.',
        parameters: {
          type: 'object',
          properties: {
            session_id: { type: ['string', 'null'], description: 'Existing session ID, or null to start new' },
            message: { type: 'string', description: 'The task or message for Claude Code' }
          },
          required: ['session_id', 'message']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'ping_user',
        description: 'Send a message to the user and pause until they respond. Use only when you cannot proceed without human input.',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'The question or information for the user' }
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

async function runClaudeCode(
  containerId: string,
  sessionId: string | null,
  message: string
): Promise<{ output: string; newSessionId: string | null }> {
  return new Promise((resolve, reject) => {
    const sidArg = sessionId ?? 'new'
    const child = spawn('docker', ['exec', containerId, 'node', '/usr/local/bin/cw-claude-sdk.js', sidArg, message])

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      parentPort?.postMessage({ type: 'stream-chunk', chunk: text })
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('close', (code) => {
      if (code !== 0 && !stdout) {
        reject(new Error(`docker exec failed (exit ${code}): ${stderr}`))
        return
      }
      const { outputLines, sessionId: newSessionId } = parseDockerOutput(stdout, stderr)
      resolve({ output: outputLines.join('\n'), newSessionId })
    })

    child.on('error', reject)
  })
}

type KimiLoopData = {
  windowId: number
  containerId: string
  message: string
  conversationHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  systemPrompt: string
  fireworksKey: string
}

type ToolCallAccum = { id: string; name: string; arguments: string }

async function handlePingUser(
  windowId: number,
  tc: ToolCallAccum,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
): Promise<string> {
  const args = JSON.parse(tc.arguments) as { message: string }
  parentPort?.postMessage({ type: 'ping-user', windowId, message: args.message })
  parentPort?.postMessage({ type: 'save-message', windowId, role: 'ping_user', content: args.message, metadata: null })

  const userReply = await new Promise<string>((resolve) => {
    parentPort?.once('message', (msg: { type: string; message: string }) => {
      if (msg.type === 'resume') resolve(msg.message)
    })
  })

  messages.push({ role: 'user', content: userReply })
  parentPort?.postMessage({ type: 'save-message', windowId, role: 'user', content: userReply, metadata: null })
  return userReply
}

async function handleRunClaudeCode(
  windowId: number,
  containerId: string,
  tc: ToolCallAccum,
  activeSessionId: string | null
): Promise<{ toolResult: string; newActiveSessionId: string | null }> {
  const args = JSON.parse(tc.arguments) as { session_id: string | null; message: string }
  let output: string
  let newActiveSessionId = activeSessionId

  try {
    const result = await runClaudeCode(containerId, args.session_id ?? activeSessionId, args.message)
    output = result.output
    newActiveSessionId = result.newSessionId ?? activeSessionId
  } catch (err) {
    output = `ERROR: ${err instanceof Error ? err.message : String(err)}`
  }

  parentPort?.postMessage({
    type: 'save-message', windowId, role: 'tool_result', content: output,
    metadata: JSON.stringify({ session_id: newActiveSessionId, complete: true, tool_name: 'run_claude_code' })
  })
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
  const { windowId, containerId, message, conversationHistory, systemPrompt, fireworksKey } = data

  const client = new OpenAI({ apiKey: fireworksKey, baseURL: 'https://api.fireworks.ai/inference/v1' })

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: message }
  ]

  parentPort?.postMessage({ type: 'save-message', windowId, role: 'user', content: message, metadata: null })

  let activeSessionId: string | null = null
  const tokenRef = { input: 0, output: 0 }

  while (true) {
    const kimiDeltaRef = { value: '' }
    const toolCalls: ToolCallAccum[] = []
    const currentIndexRef = { value: -1 }

    const stream = await client.chat.completions.create({
      model: 'accounts/fireworks/models/kimi-k2-instruct',
      messages,
      tools: buildKimiTools(),
      stream: true
    })

    for await (const chunk of stream) {
      await processStreamChunk(chunk, kimiDeltaRef, toolCalls, currentIndexRef, tokenRef, windowId)
    }

    if (kimiDeltaRef.value) {
      messages.push({ role: 'assistant', content: kimiDeltaRef.value })
      parentPort?.postMessage({
        type: 'save-message', windowId, role: 'assistant', content: kimiDeltaRef.value,
        metadata: JSON.stringify({ input_tokens: tokenRef.input, output_tokens: tokenRef.output })
      })
    }

    if (toolCalls.length === 0) break

    messages.push({
      role: 'assistant',
      content: kimiDeltaRef.value || null,
      tool_calls: toolCalls.map(tc => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: tc.arguments } }))
    })

    for (const tc of toolCalls) {
      let toolResult: string

      if (tc.name === 'ping_user') {
        toolResult = await handlePingUser(windowId, tc, messages)
      } else if (tc.name === 'run_claude_code') {
        const res = await handleRunClaudeCode(windowId, containerId, tc, activeSessionId)
        toolResult = res.toolResult
        activeSessionId = res.newActiveSessionId
      } else {
        toolResult = 'Unknown tool'
      }

      messages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult })
    }
  }

  const costUsd = (tokenRef.input * 0.000001) + (tokenRef.output * 0.000003)
  parentPort?.postMessage({
    type: 'turn-complete', windowId,
    stats: { inputTokens: tokenRef.input, outputTokens: tokenRef.output, costUsd }
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
