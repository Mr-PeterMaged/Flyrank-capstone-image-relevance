import { z } from 'zod';
export const subjects = ['red fox','gray wolf','domestic dog','brown bear','deer','pizza','coffee','mountain','forest','car','bicycle','unknown'];
export const visionSchema = z.object({
  subject: z.enum(subjects), category: z.enum(['animal','food','landscape','vehicle','other']),
  attributes: z.array(z.string().trim().min(1).max(80)).max(8),
  caption: z.string().trim().min(5).max(800), confidence: z.number().finite().min(0).max(1),
}).strict();
export const credentialsSchema = z.object({ email: z.email().max(254).transform((v) => v.toLowerCase()), password: z.string().min(12).max(128) }).strict();
export const postSchema = z.object({ title: z.string().trim().min(3).max(180), content: z.string().trim().min(10).max(6000) }).strict();
export const pageSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(40), offset: z.coerce.number().int().min(0).max(100000).default(0) }).strict();
export const reviewSchema = z.object({ decision: z.enum(['approve','reject']), note: z.string().trim().max(1000).default('') }).strict();
export class HttpError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'validation_error', r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return r.data;
}
export const uuid = (value) => parse(z.uuid(), value);
export const notFound = () => new HttpError(404, 'not_found', 'Resource not found');
export function vector(input) {
  if (!Array.isArray(input) || input.length < 8 || input.length > 4096 || !input.every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error('invalid_embedding');
  const norm = Math.hypot(...input);
  if (norm < 1e-10) throw new Error('zero_embedding');
  return input.map((v) => v / norm);
}
