import { z } from 'zod';

/**
 * Zod schemas — the single source of truth for request-body validation.
 * `.strip()` semantics (default) drop unknown keys so clients can't smuggle
 * extra fields into a create/update.
 */
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const digestSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(['daily', 'weekly', 'monthly']).optional().default('weekly'),
});

export const forgotPasswordSchema = z.object({ email: z.string().email() });

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(6, 'Password must be at least 6 characters').max(200),
});

/** Self-service account update (both roles). */
export const updateMeSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    email: z.string().email().optional(),
    currentPassword: z.string().min(1).optional(),
    newPassword: z.string().min(6, 'New password must be at least 6 characters').max(200).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })
  .refine((v) => !v.newPassword || v.currentPassword, {
    message: 'Current password is required to set a new one',
    path: ['currentPassword'],
  });

export const trainerCreateSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(6).max(200),
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
  defaultPassword: z.string().min(6, 'Default password must be at least 6 characters').max(200),
});

export const trainerUpdateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    email: z.string().email().optional(),
    password: z.string().min(6).max(200).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const classCreateSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(1000).optional().default(''),
  trainer: objectId,
});

export const classUpdateSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    description: z.string().max(1000).optional(),
    trainer: objectId.optional(),
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
 * One class in a batch: the catalog class plus the trainer teaching it in THIS
 * batch. `trainer` is optional on the wire — when omitted the controller falls
 * back to the class's catalog trainer — but is always stored concretely.
 */
const batchClassInput = z.object({
  class: objectId,
  trainer: objectId.optional(),
});

export const batchCreateSchema = z.object({
  // A batch holds many catalog classes (subjects), each with its (optionally
  // overridden) trainer. At least one is required; capped at 50 so the student
  // form and the atomic write stay bounded.
  classes: z.array(batchClassInput).min(1, 'Select at least one class').max(50),
  name: z.string().min(1).max(160),
  expectedCount: z.number().int().min(0).max(100000).optional().default(0),
});

/** PATCH /api/batches/:id — rename or change the class/trainer set (while locked). */
export const batchUpdateSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
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
 * against the batch and the parameter set against the active parameters — this
 * schema only guarantees the shape.
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
