import { z } from 'zod'

/** SDK AskUserQuestion 的选项；label 是写回 answers 的值。 */
export const UserQuestionOption = z.object({
  label: z.string().min(1),
  description: z.string(),
  preview: z.string().optional(),
})
export type UserQuestionOption = z.infer<typeof UserQuestionOption>

export const UserQuestion = z.object({
  question: z.string().min(1),
  header: z.string().min(1),
  options: z.array(UserQuestionOption).min(2).max(4),
  multiSelect: z.boolean(),
})
export type UserQuestion = z.infer<typeof UserQuestion>

export const UserQuestionList = z.array(UserQuestion).min(1).max(4)
export type UserQuestionList = z.infer<typeof UserQuestionList>
