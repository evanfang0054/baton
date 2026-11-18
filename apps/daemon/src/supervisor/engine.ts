import { SUPERVISOR_POLICY } from '@baton/core'
import type { SupervisorMessage, ToolCallRecord } from '@baton/protocol'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { stepCountIs, streamText, tool, type ToolSet } from 'ai'
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
  }
}
