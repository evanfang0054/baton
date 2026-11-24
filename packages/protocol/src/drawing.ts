import { z } from 'zod'
import { Id } from './common.js'

const Point = z.number().finite()
const Size = z.number().positive().max(10_000)
const ElementId = z.string().min(1).max(64)
const Text = z.string().max(4000)
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/)

const DrawingPoint = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict()

export const DrawingShape = z.enum(['rectangle', 'ellipse', 'diamond'])
export type DrawingShape = z.infer<typeof DrawingShape>

export const DrawingOperation = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('add_text'),
      id: ElementId.optional(),
      x: Point,
      y: Point,
      text: z.string().min(1).max(4000),
      w: Size.optional(),
      h: Size.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('add_shape'),
      id: ElementId.optional(),
      shape: DrawingShape,
      x: Point,
      y: Point,
      w: Size,
      h: Size,
      text: Text.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('add_arrow'),
      id: ElementId.optional(),
      x: Point,
      y: Point,
      w: Size,
      h: Size,
      fromId: ElementId.optional(),
      toId: ElementId.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('add_line'),
      id: ElementId.optional(),
      x: Point,
      y: Point,
      w: Size,
      h: Size,
    })
    .strict(),
  z
    .object({
      op: z.literal('add_freedraw'),
      id: ElementId.optional(),
      x: Point,
      y: Point,
      points: z.array(DrawingPoint).min(2).max(2000),
    })
    .strict(),
  z
    .object({
      op: z.literal('add_image'),
      id: ElementId.optional(),
      path: z.string().min(1).max(1024),
      x: Point,
      y: Point,
      w: Size.optional(),
      h: Size.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('update_text'),
      id: ElementId,
      text: Text,
    })
    .strict(),
  z
    .object({
      op: z.literal('move_element'),
      id: ElementId,
      x: Point.optional(),
      y: Point.optional(),
      dx: Point.optional(),
      dy: Point.optional(),
    })
    .strict()
    .refine(
      (value) =>
        value.x !== undefined ||
        value.y !== undefined ||
        value.dx !== undefined ||
        value.dy !== undefined,
      { message: 'move_element requires x/y or dx/dy' },
    ),
  z
    .object({
      op: z.literal('resize_element'),
      id: ElementId,
      w: Size,
      h: Size,
    })
    .strict(),
  z
    .object({
      op: z.literal('delete_elements'),
      ids: z.array(ElementId).min(1).max(50),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_style'),
      id: ElementId,
      strokeColor: Color.optional(),
      backgroundColor: Color.optional(),
      fillStyle: z.enum(['solid', 'hachure', 'cross-hatch']).optional(),
      strokeWidth: z.number().positive().max(20).optional(),
      strokeStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
      roughness: z.number().min(0).max(2).optional(),
      opacity: z.number().min(0).max(100).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_title'),
      title: z.string().trim().min(1).max(80),
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
