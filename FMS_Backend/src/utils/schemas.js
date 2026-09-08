import { z } from 'zod';
import { MIN_PASSWORD_LENGTH, validatePasswordStrength } from './password.js';

/**
 * Zod schemas — the single source of truth for request-body validation.
 * `.strip()` semantics (default) drop unknown keys so clients can't smuggle
 * extra fields into a create/update.
 */
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/**
 * A password field, checked for length AND for the weak-choice rules in
 * password.js. Defined once so every path that sets a password (create, bulk
 * import, self-service change, reset) enforces the same bar — previously the
 * reset path allowed 6 characters while the rest allowed 6 too, leaving no
 * single place to raise it.
 */
const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(200)
  .superRefine((val, ctx) => {
    const problem = validatePasswordStrength(val);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

export const loginSchema = z.object({
  email: z.string().email(),
  // NOT the `password` schema: an existing account may legitimately hold a
  // shorter password set before the bar was raised, and rejecting it at login
  // would lock that person out of the very screen where they can change it.
  password: z.string().min(1),
});

export const digestSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(['daily', 'weekly', 'monthly']).optional().default('weekly'),
});

export const forgotPasswordSchema = z.object({ email: z.string().email() });

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  newPassword: password,
});

/** Self-service account update (both roles). */
export const updateMeSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    email: z.string().email().optional(),
    currentPassword: z.string().min(1).optional(),
    newPassword: password.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })
  .refine((v) => !v.newPassword || v.currentPassword, {
    message: 'Current password is required to set a new one',
    path: ['currentPassword'],
  });

export const trainerCreateSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password,
  phone: z.string().max(32).optional().default(''),
  shortName: z.string().max(60).optional().default(''),
});

/** Bulk import — step 1: parse an uploaded workbook (nothing is written). */
export const trainerBulkPreviewSchema = z.object({
  // Base64 rather than multipart: it needs no new server dependency, and a
  // 500-row .xlsx is well inside the JSON body limit.
  fileBase64: z.string().min(1),
  filename: z.string().max(255).optional().default(''),
});

/**
 * Bulk import — step 2: create the reviewed rows.
 *
 * Every account gets ONE `defaultPassword` chosen by the admin at import time,
 * rather than a per-row password column. Capped at 500 rows: large enough for a
 * real intake, small enough to stay inside the body limit.
 */
export const trainerBulkSchema = z.object({
  trainers: z
    .array(
      z.object({
        firstName: z.string().min(1).max(80),
        lastName: z.string().min(1).max(80),
        email: z.string().email(),
        phone: z.string().max(32).optional().default(''),
        row: z.number().int().optional(),
      })
    )
    .min(1)
    .max(500),
  defaultPassword: password,
});

export const trainerUpdateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    email: z.string().email().optional(),
    password: password.optional(),
    phone: z.string().max(32).optional(),
    shortName: z.string().max(60).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const classCreateSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(1000).optional().default(''),
  // A subject need not have a permanent owner — staffing is decided per batch.
  // `null` clears it; omitting it leaves the subject unassigned.
  trainer: objectId.nullish(),
});

export const classUpdateSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    description: z.string().max(1000).optional(),
    trainer: objectId.nullish(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const parameterCreateSchema = z.object({
  label: z.string().min(1).max(120),
  description: z.string().max(500).optional().default(''),
  order: z.number().int().min(0).optional(),
});

export const parameterUpdateSchema = z
  .object({
    label: z.string().min(1).max(120).optional(),
    description: z.string().max(500).optional(),
    order: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

/**
 * One class in a batch: the catalog subject plus the mentor team teaching it in
 * THIS batch — main mentors who deliver it and support mentors who assist.
 *
 * `trainer` (singular) is accepted as a LEGACY alias and folded into
 * `mainTrainers`, so an older client or a saved integration script keeps
 * working instead of failing validation with a confusing "mainTrainers
 * required". Both rosters are optional on the wire: the controller falls back
 * to the subject's default trainer when no main mentor is named, and rejects
 * the entry if that still leaves it unstaffed.
 */
const batchClassInput = z
  .object({
    class: objectId,
    mainTrainers: z.array(objectId).max(10, 'At most 10 main mentors per class').optional(),
    supportTrainers: z.array(objectId).max(20, 'At most 20 support mentors per class').optional(),
    trainer: objectId.optional(), // legacy single-trainer alias
  })
  .transform((v) => {
    const main = [...(v.mainTrainers || [])];
    if (v.trainer && !main.includes(v.trainer)) main.push(v.trainer);
    return {
      class: v.class,
      mainTrainers: [...new Set(main)],
      supportTrainers: [...new Set(v.supportTrainers || [])],
    };
  })
  .refine((v) => !v.mainTrainers.some((id) => v.supportTrainers.includes(id)), {
    message: 'A mentor cannot be both main and support for the same class',
    path: ['supportTrainers'],
  });

export const batchCreateSchema = z.object({
  // A batch holds many catalog classes (subjects), each with its mentor team.
  // At least one is required; capped at 50 so the student form and the atomic
  // write stay bounded.
  classes: z.array(batchClassInput).min(1, 'Select at least one class').max(50),
  name: z.string().min(1).max(160),
  // Institutional placement — free text, drives the dashboard filters.
  yearGroup: z.string().max(80).optional().default(''),
  dept: z.string().max(160).optional().default(''),
  expectedCount: z.number().int().min(0).max(100000).optional().default(0),
});

/** PATCH /api/batches/:id — rename or change the class/mentor set (while locked). */
export const batchUpdateSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    yearGroup: z.string().max(80).optional(),
    dept: z.string().max(160).optional(),
    expectedCount: z.number().int().min(0).max(100000).optional(),
    classes: z.array(batchClassInput).min(1).max(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const batchUnlockSchema = z.object({
  expectedCount: z.number().int().min(1).max(100000),
});

export const verifyPasscodeSchema = z.object({
  batchId: objectId,
  passcode: z.string().min(1).max(64),
});

/**
 * One class's block of a submission: a star for each parameter plus a comment
 * about THAT class. A batch's payload carries one of these per class in the
 * batch (see feedbackSubmitSchema). The controller cross-checks the classId set
 * against the batch and the parameter set against the ones issued at verify
 * time — this schema only guarantees the shape.
 */
export const classFeedbackSchema = z.object({
  classId: objectId,
  ratings: z
    .array(
      z.object({
        parameter: objectId,
        stars: z.number().int().min(1).max(5),
      })
    )
    .min(1),
  comment: z.string().trim().min(10, 'Please write at least 10 characters').max(2000),
});

export const feedbackSubmitSchema = z.object({
  batchId: objectId,
  // One entry per class in the batch — the student rates every class.
  classes: z.array(classFeedbackSchema).min(1, 'Rate at least one class').max(50),
  // Lightweight, non-identifying client hint for the device signature.
  fingerprint: z.string().max(256).optional().default(''),
  // Short-lived proof the passcode gate was passed (from verify-passcode). May
  // instead be sent via the `x-feedback-session` header — either is accepted.
  sessionToken: z.string().optional(),
});

/** Common list/pagination query for the admin tables. */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  q: z.string().max(200).optional().default(''),
  // 'all' is explicit rather than implied by omission, so a caller must opt in
  // to seeing archived records instead of getting them by accident.
  archived: z.enum(['live', 'archived', 'all']).optional().default('live'),
  status: z.enum(['open', 'locked']).optional(),
  yearGroup: z.string().max(80).optional(),
  class: objectId.optional(),
  trainer: objectId.optional(),
});

/**
 * GET /api/audit query. The handler places several of these directly into a
 * Mongo filter, so they are validated here rather than trusted.
 */
export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(5).max(100).optional().default(25),
  action: z.string().max(60).regex(/^[a-z_]+\.[a-z_]+$/, 'Invalid action').optional(),
  entity: z.string().max(40).regex(/^[a-z_]+$/, 'Invalid entity').optional(),
  actor: objectId.optional(),
  q: z.string().max(200).optional().default(''),
  from: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  to: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
});
