import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createAiSdkSupervisorEngine } from '../src/supervisor/engine.js'
import type { BoundToolset } from '../src/supervisor/tools.js'

const servers: Array<ReturnType<typeof createServer>> = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    ),
  )
})

function sse(res: ServerResponse, payload: unknown) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function chunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return {
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'mock-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  let body = ''
  for await (const part of req) body += String(part)
  return body
}

/** 模拟 OpenAI-compatible SSE：第一次返回 create_task 工具调用，第二次返回文本。 */
async function startMockModel(onRequest?: (body: unknown) => void) {
  const server = createServer(async (req, res) => {
    if (!req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end()
      return
    }
    const body = JSON.parse(await readBody(req)) as {
      messages?: Array<{ role?: string }>
    }
    onRequest?.(body)
    const hasToolResult = body.messages?.some((message) => message.role === 'tool') ?? false
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    if (!hasToolResult) {
      sse(
        res,
        chunk({
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: {
                name: 'create_task',
                arguments: JSON.stringify({ title: '登录页暗黑模式' }),
              },
            },
          ],
        }),
      )
      sse(res, chunk({}, 'tool_calls'))
    } else {
      sse(res, chunk({ role: 'assistant', content: '已建到待办，不会自动开工。' }))
      sse(res, chunk({}, 'stop'))
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('mock model did not bind')
  return `http://127.0.0.1:${address.port}/v1`
}

function tools(): BoundToolset {
  const noop = {
    description: 'noop',
    parameters: z.object({}),
    execute: async () => ({}),
  }
  return {
    list_canvas: noop,
    list_tasks: noop,
    get_task: noop,
    get_task_history: noop,
    get_task_failure: noop,
    enqueue_task: noop,
    retry_task: noop,
    reopen_task: noop,
    cancel_task: noop,
    reply_task: noop,
    inject_context: noop,
    create_tasks: noop,
    plan_tasks: noop,
    batch_tasks: noop,
    decide_action: noop,
    handoff_task: noop,
    create_text: noop,
    create_agent: noop,
    create_edge: noop,
    update_node: noop,
    create_task: {
      description: 'create a todo task',
      parameters: z.object({ title: z.string().min(1) }),
      execute: async (input) => ({
        taskId: 'task-1',
        title: (input as { title: string }).title,
        target: { id: 'a1', title: 'Agent 1', engine: 'fake' },
        contextCount: 1,
        status: 'todo',
      }),
    },
  }
}

describe('createAiSdkSupervisorEngine with a mock OpenAI-compatible model', () => {
  it('streams text and executes a tool call without a real provider key', async () => {
    const sentTools: string[] = []
    const baseUrl = await startMockModel((body) => {
      if (sentTools.length > 0) return
      const requestTools = (body as { tools?: Array<{ function?: { name?: string } }> }).tools ?? []
      sentTools.push(...requestTools.map((item) => item.function?.name ?? '').filter(Boolean))
    })
    const engine = createAiSdkSupervisorEngine({
      baseUrl,
      apiKey: 'test-key',
      model: 'mock-model',
    })
    const deltas: string[] = []

    const result = await engine.run({
      system: 'test system prompt',
      messages: [
        {
          id: 'm1',
          threadId: 'th1',
          role: 'user',
          content: '给这个 Agent 建个任务',
          toolCalls: [],
          decision: null,
          meta: null,
          status: 'ok',
          error: null,
          createdAt: 1,
        },
      ],
      tools: tools(),
      signal: new AbortController().signal,
      onDelta: (delta) => deltas.push(delta),
    })

    expect(result.text).toBe('已建到待办，不会自动开工。')
    expect(deltas.join('')).toBe(result.text)
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]).toMatchObject({
      name: 'create_task',
      ok: true,
      args: { title: '登录页暗黑模式' },
    })
    expect(sentTools.sort()).toEqual([
      'batch_tasks',
      'cancel_task',
      'create_agent',
      'create_edge',
      'create_task',
      'create_tasks',
      'create_text',
      'decide_action',
      'enqueue_task',
      'get_task',
      'get_task_failure',
      'get_task_history',
      'handoff_task',
      'inject_context',
      'list_canvas',
      'list_tasks',
      'plan_tasks',
      'reopen_task',
      'reply_task',
      'retry_task',
      'update_node',
    ])
  })
})
