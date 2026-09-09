import { z } from 'zod';

import { cursorQuerySchema } from '@core/database/pagination';

export const createCommentSchema = z.object({
  text: z.string().trim().min(1).max(500),
});

export const commentIdParamsSchema = z.object({ id: z.uuid() });

/**
 * A thread reads oldest first: a conversation only makes sense in the order it happened, and
 * the shared default (`desc`, right for a feed) would show every reply before what it answers.
 */
export const commentQuerySchema = cursorQuerySchema.extend({
  direction: z.enum(['asc', 'desc']).default('asc'),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
