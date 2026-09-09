import { z } from 'zod';

/**
 * Reserved because they would collide with a route: `/profiles/me` has to keep meaning the
 * caller, whatever anyone tries to register.
 */
const RESERVED_HANDLES = new Set(['me', 'admin', 'api', 'new', 'search', 'about', 'settings']);

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9](?:[a-z0-9_]*[a-z0-9])?$/, 'must be letters, digits and underscores')
  .refine((handle) => !RESERVED_HANDLES.has(handle), 'this handle is reserved');

export const createProfileSchema = z.object({
  handle: handleSchema,
  displayName: z.string().trim().min(1).max(80),
  bio: z.string().trim().max(280).nullable().default(null),
  location: z.string().trim().max(80).nullable().default(null),
  website: z.url().max(200).nullable().default(null),
});

export const updateProfileSchema = z
  .object({
    handle: handleSchema,
    displayName: z.string().trim().min(1).max(80),
    bio: z.string().trim().max(280).nullable(),
    location: z.string().trim().max(80).nullable(),
    website: z.url().max(200).nullable(),
  })
  .partial();

export const handleParamsSchema = z.object({ handle: handleSchema });

export type CreateProfileInput = z.infer<typeof createProfileSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
