import { ReviewDiffResponse } from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import { getReview, getReviewDiff } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'

export function registerReviewRoutes(app: FastifyInstance, deps: { db: Db }): void {
  app.get('/api/reviews/:reviewId/diff', async (req) => {
    const { reviewId } = req.params as { reviewId?: string }
    if (!reviewId) {
      throw appError('invalid_payload', 'review id is required')
    }
    const review = getReview(deps.db, reviewId)
    if (!review) {
      throw appError('review_not_found', 'review not found', { reviewId })
    }
    const snapshot = getReviewDiff(deps.db, reviewId)
    if (!snapshot) {
      throw appError('diff_unavailable', 'diff snapshot is not available', { reviewId })
    }
    return ReviewDiffResponse.parse({ reviewId, taskId: review.taskId, snapshot })
  })
}
