import { z } from 'zod';
import { Uuid } from './common';

// §2.1 — controlled vocabulary, never free-text. icon+audio for low-literacy (§25.1).
export const Specialty = z.object({
  id: Uuid,
  slug: z.string().regex(/^[a-z0-9_]+$/),
  name_ps: z.string().nullable(),
  name_ur: z.string().nullable(),
  name_en: z.string().nullable(),
  icon: z.string().nullable(),
  active: z.boolean(),
});
export type Specialty = z.infer<typeof Specialty>;
