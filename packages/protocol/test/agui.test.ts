import { describe, expect, it } from 'vitest'
import { EventSchemas } from '../src/agui.js'

describe('AG-UI', () => {
  it('parses a real TEXT_MESSAGE_CONTENT event', () => {
    const parsed = EventSchemas.parse({
      type: 'TEXT_MESSAGE_CONTENT',
      messageId: 'm1',
      delta: 'hello',
    })
    expect(parsed.type).toBe('TEXT_MESSAGE_CONTENT')
  })
})
