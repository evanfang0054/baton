import { z } from 'zod'
import { Id } from './common.js'

const Point = z.number().finite()
const Size = z.number().positive().max(10_000)

export const DrawingOperation = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('add_text'),
      id: z.string().min(1).max(64).optional(),
      x: Point,
      y: Point,
      text: z.string().min(1).max(4000),
      w: Size.optional(),
      h: Size.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('add_rectangle'),
      id: z.string().min(1).max(64).optional(),
      x: Point,
      y: Point,
      w: Size,
      h: Size,
      text: z.string().min(1).max(4000).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('add_ellipse'),
      id: z.string().min(1).max(64).optional(),
      x: Point,
      y: Point,
      w: Size,
      h: Size,
      text: z.string().min(1).max(4000).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('add_arrow'),
      id: z.string().min(1).max(64).optional(),
      x: Point,
      y: Point,
      w: Size,
      h: Size,
      fromId: z.string().min(1).max(64).optional(),
      toId: z.string().min(1).max(64).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('add_image'),
      id: z.string().min(1).max(64).optional(),
      path: z.string().min(1).max(1024),
      x: Point,
      y: Point,
      w: Size.optional(),
      h: Size.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('update_element'),
      id: z.string().min(1).max(64),
      x: Point.optional(),
      y: Point.optional(),
      w: Size.optional(),
      h: Size.optional(),
      text: z.string().max(4000).optional(),
    })
    .strict()
    .refine(
      (value) =>
        value.x !== undefined ||
        value.y !== undefined ||
        value.w !== undefined ||
        value.h !== undefined ||
        value.text !== undefined,
      { message: 'update_element requires at least one field' },
    ),
  z
    .object({
      op: z.literal('delete_element'),
      id: z.string().min(1).max(64),
    })
    .strict(),
])
export type DrawingOperation = z.infer<typeof DrawingOperation>

export const SupervisorDrawingCard = z
  .object({
    artifactId: Id,
    deliveryId: Id,
    nodeId: Id,
    title: z.string().min(1).max(200),
    elements: z.number().int().nonnegative(),
    texts: z.number().int().nonnegative(),
    previewStale: z.boolean().default(true),
  })
  .strict()
export type SupervisorDrawingCard = z.infer<typeof SupervisorDrawingCard>
