import { afterEach, describe, expect, it } from 'vitest'
import { buildTestApp } from './helpers/app.js'

const apps: Array<Awaited<ReturnType<typeof buildTestApp>>> = []

afterEach(async () => {
  await Promise.all(
    apps.splice(0).map(async ({ app, handle }) => {
      await app.close()
      await handle.cleanup()
    }),
  )
})

describe('attention REST', () => {
  it('returns delivery-bound attention items and validates limit', async () => {
    const built = await buildTestApp()
    apps.push(built)

    const created = await built.app.inject({
      method: 'POST',
      url: '/api/deliveries',
      payload: {
        workspaceId: built.handle.seeded.workspaceId,
        title: '优惠券领取页',
        goal: '做一个领取页',
      },
    })
    expect(created.statusCode).toBe(200)
    const delivery = (created.json() as { delivery: { id: string } }).delivery

    built.handle.database.raw
      .prepare(
        `update task
         set delivery_id = ?, stage_key = 'requirement', status = 'waiting_input',
             waiting_reason = 'question', updated_at = 10
         where id = ?`,
      )
      .run(delivery.id, built.handle.seeded.taskId)

    const response = await built.app.inject({ method: 'GET', url: '/api/attention' })
    expect(response.statusCode).toBe(200)
    const body = response.json() as {
      items: Array<{
        workspaceId: string
        deliveryId: string
        taskId: string
        kind: string
        waitingSince: number | null
      }>
    }
    expect(body.items[0]).toMatchObject({
      workspaceId: built.handle.seeded.workspaceId,
      deliveryId: delivery.id,
      taskId: built.handle.seeded.taskId,
      kind: 'needs_reply',
      waitingSince: 10,
    })

    const tooSmall = await built.app.inject({ method: 'GET', url: '/api/attention?limit=0' })
    expect(tooSmall.statusCode).toBe(400)
    const nan = await built.app.inject({ method: 'GET', url: '/api/attention?limit=abc' })
    expect(nan.statusCode).toBe(400)
  })
})
