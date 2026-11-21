import { SUPERVISOR_POLICY } from '@baton/core'
import type { SupervisorMessage, ToolCallRecord } from '@baton/protocol'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs, streamText, tool, type ToolSet } from 'ai'
import type { SupervisorConfig } from './config.js'
import type { BoundToolset } from './tools.js'

export interface SupervisorEngine {
  run(input: {
    system: string
    messages: SupervisorMessage[]
    tools: BoundToolset
    signal: AbortSignal
    onDelta(text: string): void
  }): Promise<{
    text: string
    toolCalls: ToolCallRecord[]
    finishReason: string
  }>
  /** 可选：把模板通知润色成更像人的汇报；不可用时保留模板。 */
  summarize?(input: { system: string; prompt: string; signal: AbortSignal }): Promise<string>
}

export function createAiSdkSupervisorEngine(config: SupervisorConfig): SupervisorEngine {
  const provider = createOpenAICompatible({
    name: 'baton-supervisor',
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  })

  return {
    async run({ system, messages, tools, signal, onDelta }) {
      const sdkTools: ToolSet = {
        list_canvas: tool({
          description: tools.list_canvas.description,
          inputSchema: tools.list_canvas.parameters,
          execute: (input) => tools.list_canvas.execute(input),
        }),
        list_tasks: tool({
          description: tools.list_tasks.description,
          inputSchema: tools.list_tasks.parameters,
          execute: (input) => tools.list_tasks.execute(input),
        }),
        get_task: tool({
          description: tools.get_task.description,
          inputSchema: tools.get_task.parameters,
          execute: (input) => tools.get_task.execute(input),
        }),
        create_task: tool({
          description: tools.create_task.description,
          inputSchema: tools.create_task.parameters,
          execute: (input) => tools.create_task.execute(input),
        }),
        enqueue_task: tool({
          description: tools.enqueue_task.description,
          inputSchema: tools.enqueue_task.parameters,
          execute: (input) => tools.enqueue_task.execute(input),
        }),
        create_text: tool({
          description: tools.create_text.description,
          inputSchema: tools.create_text.parameters,
          execute: (input) => tools.create_text.execute(input),
        }),
        create_agent: tool({
          description: tools.create_agent.description,
          inputSchema: tools.create_agent.parameters,
          execute: (input) => tools.create_agent.execute(input),
        }),
        create_edge: tool({
          description: tools.create_edge.description,
          inputSchema: tools.create_edge.parameters,
          execute: (input) => tools.create_edge.execute(input),
        }),
        get_task_history: tool({
          description: tools.get_task_history.description,
          inputSchema: tools.get_task_history.parameters,
          execute: (input) => tools.get_task_history.execute(input),
        }),
        retry_task: tool({
          description: tools.retry_task.description,
          inputSchema: tools.retry_task.parameters,
          execute: (input) => tools.retry_task.execute(input),
        }),
        reopen_task: tool({
          description: tools.reopen_task.description,
          inputSchema: tools.reopen_task.parameters,
          execute: (input) => tools.reopen_task.execute(input),
        }),
        cancel_task: tool({
          description: tools.cancel_task.description,
          inputSchema: tools.cancel_task.parameters,
          execute: (input) => tools.cancel_task.execute(input),
        }),
        reply_task: tool({
          description: tools.reply_task.description,
          inputSchema: tools.reply_task.parameters,
          execute: (input) => tools.reply_task.execute(input),
        }),
        create_tasks: tool({
          description: tools.create_tasks.description,
          inputSchema: tools.create_tasks.parameters,
          execute: (input) => tools.create_tasks.execute(input),
        }),
        handoff_task: tool({
          description: tools.handoff_task.description,
          inputSchema: tools.handoff_task.parameters,
          execute: (input) => tools.handoff_task.execute(input),
        }),
      }

      const result = streamText({
        model: provider.languageModel(config.model),
        system,
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        tools: sdkTools,
        stopWhen: stepCountIs(SUPERVISOR_POLICY.maxSteps),
        maxOutputTokens: SUPERVISOR_POLICY.maxOutputTokens,
        abortSignal: signal,
      })

      let text = ''
      for await (const delta of result.textStream) {
        text += delta
        onDelta(delta)
      }

      const steps = await result.steps
      const toolCalls: ToolCallRecord[] = []
      for (const step of steps) {
        for (const call of step.toolCalls) {
          const toolResult = step.toolResults.find((item) => item.toolCallId === call.toolCallId)
          toolCalls.push({
            id: call.toolCallId,
            name: call.toolName,
            args: call.input,
            ok: Boolean(toolResult),
            ...(toolResult ? { result: toolResult.output } : { error: 'tool call failed' }),
          })
        }
      }

      return { text, toolCalls, finishReason: await result.finishReason }
    },

    async summarize({ system, prompt, signal }) {
      const result = await generateText({
        model: provider.languageModel(config.model),
        system,
        prompt,
        maxOutputTokens: 320,
        abortSignal: signal,
      })
      return result.text
    },
  }
}
