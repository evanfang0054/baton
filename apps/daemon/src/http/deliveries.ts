import {
  AnnotationCreateInput,
  AnnotationListQuery,
  AnnotationListResponse,
  AnnotationResponse,
  AnnotationUpdateInput,
  ArtifactCreateInput,
  ArtifactListResponse,
  ArtifactResponse,
  ArtifactSaveInput,
  DeliveryActionResponse,
  DeliveryCreateInput,
  DeliveryCreateResponse,
  DeliveryDetailResponse,
  DeliveryListQuery,
  DeliveryListResponse,
} from '@baton/protocol'
import type { ClientMessage } from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import type { AnnotationService } from '../annotation/service.js'
import type { ArtifactService } from '../artifact/service.js'
import type { DeliveryService } from '../delivery/service.js'
import { appError } from '../errors.js'
import type { Runtime } from '../runtime/index.js'

export interface DeliveryRoutesDeps {
  deliveries: DeliveryService
  artifacts: ArtifactService
  annotations: AnnotationService
  runtime: Pick<Runtime, 'handleCommand'>
  now: () => number
  newId: () => string
}

export function registerDeliveryRoutes(app: FastifyInstance, deps: DeliveryRoutesDeps): void {
  app.get('/api/deliveries', async (req) => {
    const query = DeliveryListQuery.safeParse(req.query)
    if (!query.success)
      throw appError('invalid_payload', 'invalid delivery query', query.error.issues)
    return DeliveryListResponse.parse({
      deliveries: deps.deliveries.listDeliveries(query.data.workspaceId),
    })
  })

  app.post('/api/deliveries', async (req) => {
    const input = DeliveryCreateInput.safeParse(req.body)
    if (!input.success)
      throw appError('invalid_payload', 'invalid delivery input', input.error.issues)
    const result = deps.deliveries.createDelivery(input.data)
    if (!result.ok) throw appError(result.code, result.message)
    const detail = deps.deliveries.getDeliveryDetail(result.deliveryId)
    if (!detail) throw appError('delivery_not_found', 'delivery not found')
    return DeliveryCreateResponse.parse({ delivery: detail, taskId: result.taskId })
  })

  app.get('/api/deliveries/:deliveryId', async (req) => {
    const { deliveryId } = req.params as { deliveryId: string }
    const detail = deps.deliveries.getDeliveryDetail(deliveryId)
    if (!detail) throw appError('delivery_not_found', 'delivery not found')
    return DeliveryDetailResponse.parse({ delivery: detail })
  })

  app.post('/api/deliveries/:deliveryId/enqueue', async (req) => {
    const { deliveryId } = req.params as { deliveryId: string }
    const result = deps.deliveries.enqueueDelivery(deliveryId)
    if (!result.ok) throw appError(result.code, result.message)
    const outcome = deps.runtime.handleCommand(
      command('task.enqueue', { taskId: result.taskId }, deps),
    )
    if (!outcome.ok) throw outcome.error
    return DeliveryActionResponse.parse({ taskId: result.taskId, ack: outcome.ack })
  })

  app.post('/api/deliveries/:deliveryId/cancel', async (req) => {
    const { deliveryId } = req.params as { deliveryId: string }
    const body = (req.body ?? {}) as { reason?: string }
    const result = deps.deliveries.cancelDelivery(deliveryId)
    if (!result.ok) throw appError(result.code, result.message)
    const outcome = deps.runtime.handleCommand(
      command(
        'task.cancel',
        { taskId: result.taskId, ...(body.reason ? { reason: body.reason } : {}) },
        deps,
      ),
    )
    if (!outcome.ok) throw outcome.error
    return DeliveryActionResponse.parse({ taskId: result.taskId, ack: outcome.ack })
  })

  app.get('/api/deliveries/:deliveryId/artifacts', async (req) => {
    const { deliveryId } = req.params as { deliveryId: string }
    return ArtifactListResponse.parse({ artifacts: deps.artifacts.listArtifacts(deliveryId) })
  })

  app.get('/api/deliveries/:deliveryId/artifacts/:artifactId/content', async (req, reply) => {
    const { artifactId } = req.params as { artifactId: string }
    const { artifact, data } = deps.artifacts.readArtifactContent(artifactId)
    return reply
      .header('content-type', artifact.mime ?? 'application/octet-stream')
      .header('content-length', String(data.length))
      .send(data)
  })

  app.post('/api/deliveries/:deliveryId/stages/:stageKey/artifacts', async (req) => {
    const { deliveryId } = req.params as { deliveryId: string; stageKey: string }
    const input = ArtifactCreateInput.safeParse(req.body)
    if (!input.success)
      throw appError('invalid_payload', 'invalid artifact input', input.error.issues)
    return ArtifactResponse.parse({
      artifact: deps.artifacts.createDraftArtifact({ deliveryId, ...input.data }),
    })
  })

  app.put('/api/deliveries/:deliveryId/artifacts/:artifactId', async (req) => {
    const { artifactId } = req.params as { artifactId: string }
    const input = ArtifactSaveInput.safeParse(req.body)
    if (!input.success)
      throw appError('invalid_payload', 'invalid artifact payload', input.error.issues)
    return ArtifactResponse.parse({
      artifact: deps.artifacts.saveArtifactContent({ artifactId, ...input.data }),
    })
  })

  app.get('/api/deliveries/:deliveryId/annotations', async (req) => {
    const { deliveryId } = req.params as { deliveryId: string }
    const query = AnnotationListQuery.safeParse(req.query)
    if (!query.success)
      throw appError('invalid_payload', 'invalid annotation query', query.error.issues)
    return AnnotationListResponse.parse({
      annotations: deps.annotations.listAnnotations({ deliveryId, ...query.data }),
    })
  })

  app.post('/api/deliveries/:deliveryId/annotations', async (req) => {
    const { deliveryId } = req.params as { deliveryId: string }
    const input = AnnotationCreateInput.safeParse(req.body)
    if (!input.success)
      throw appError('invalid_payload', 'invalid annotation input', input.error.issues)
    return AnnotationResponse.parse({
      annotation: deps.annotations.createAnnotation({ deliveryId, ...input.data }),
    })
  })

  app.patch('/api/deliveries/:deliveryId/annotations/:annotationId', async (req) => {
    const { annotationId } = req.params as { annotationId: string }
    const input = AnnotationUpdateInput.safeParse(req.body)
    if (!input.success)
      throw appError('invalid_payload', 'invalid annotation update', input.error.issues)
    return AnnotationResponse.parse({
      annotation: deps.annotations.updateAnnotation({ annotationId, ...input.data }),
    })
  })
}

function command(
  type: 'task.enqueue' | 'task.cancel',
  payload: Record<string, unknown>,
  deps: Pick<DeliveryRoutesDeps, 'now' | 'newId'>,
): ClientMessage {
  return { v: 1, id: deps.newId(), ts: deps.now(), type, payload } as ClientMessage
}
