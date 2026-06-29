import { z } from 'zod';
import { Timestamp, Uuid } from './common';

// §2.2 — landmark-based, NOT a parsed street address. Swat has no street addresses.
// Geo is fuzzed in lists per §24/B9; precise pin only revealed post-confirm.
export const LocationPrecision = z.enum(['pin', 'landmark', 'tehsil_centroid']);

export const Location = z.object({
  id: Uuid,
  label: z.string().min(1).max(300),
  district: z.string().max(80).nullable(),
  tehsil: z.string().max(80).nullable(),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  precision: LocationPrecision,
  created_by: Uuid.nullable(),
  created_at: Timestamp,
});
export type Location = z.infer<typeof Location>;

export const CreateLocationInput = z.object({
  label: z.string().min(1).max(300),
  district: z.string().max(80).optional(),
  tehsil: z.string().max(80).optional(),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  precision: LocationPrecision.default('pin'),
});
