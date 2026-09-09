import { z } from 'zod';

export const MAX_POST_IMAGES = 4;

export const createPostSchema = z.object({
  text: z.string().trim().min(1).max(500),
});

export const postIdParamsSchema = z.object({ id: z.uuid() });

export type CreatePostInput = z.infer<typeof createPostSchema>;
