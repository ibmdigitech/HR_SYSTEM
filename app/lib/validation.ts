import { z } from 'zod';

// Schema for creating a ServiceConfig entry
export const serviceConfigCreateSchema = z.object({
  module: z.string().min(1),
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['text', 'number', 'boolean', 'select', 'json', 'date', 'time']),
  value: z.string(),
  options: z.any().optional(), // JSON for select options
  isActive: z.boolean().optional().default(true),
});

// Schema for updating a ServiceConfig entry (partial)
export const serviceConfigUpdateSchema = serviceConfigCreateSchema.partial();
