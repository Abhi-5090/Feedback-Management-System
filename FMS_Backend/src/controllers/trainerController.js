import { User } from '../models/User.js';
import { Class } from '../models/Class.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { hashPassword } from '../utils/password.js';
import { conflict, notFound, badRequest } from '../utils/ApiError.js';
import {
  parseTrainerWorkbook,
  buildTrainerTemplate,
  MAX_ROWS,
} from '../services/trainerImportService.js';
import { sendMail, welcomeEmail } from '../services/emailService.js';
import { env } from '../config/env.js';
import { recordAudit } from '../services/auditService.js';

// POST /api/trainers  (admin)
export const createTrainer = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) throw conflict('A user with this email already exists', 'EMAIL_TAKEN');

  const trainer = await User.create({
    name,
    email,
    passwordHash: await hashPassword(password),
    role: 'trainer',
    // The admin chose this password, so it counts as issued: the trainer is
    // held at the change-password gate until they pick their own.
    mustChangePassword: true,
  });

  // Fire-and-forget: a mail failure must not undo a created account.
  const mail = welcomeEmail({
    name: trainer.name,
    email: trainer.email,
    password,
    loginUrl: `${env.appUrl}/login`,
  });
  const delivery = await sendMail({ to: trainer.email, ...mail });

  recordAudit(req, {
    action: 'trainer.create',
    entity: 'trainer',
    entityId: trainer._id,
    entityName: trainer.name,
    meta: { emailed: delivery.ok },
  });

  res.status(201).json({ trainer, emailed: delivery.ok });
});

/**
 * GET /api/trainers/bulk/template  (admin)
 * Downloads the .xlsx template with the four required headers + examples.
 */
export const bulkTemplate = asyncHandler(async (_req, res) => {
  const buffer = await buildTrainerTemplate();
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename="trainers-template.xlsx"');
  res.send(Buffer.from(buffer));
});

/**
 * POST /api/trainers/bulk/preview  (admin)
 * Body: { fileBase64, filename }
 *
 * Parses the workbook and returns validated rows WITHOUT writing anything.
 * A preview step exists because a spreadsheet is opaque until it's parsed —
 * the admin should see which rows will be created, and which are broken, while
 * fixing them is still cheap.
 */
export const bulkPreview = asyncHandler(async (req, res) => {
  const { fileBase64, filename } = req.body;

  let buffer;
  try {
    buffer = Buffer.from(fileBase64, 'base64');
  } catch {
    throw badRequest('The uploaded file could not be decoded.', 'BAD_FILE');
  }
  if (!buffer.length) throw badRequest('The uploaded file is empty.', 'BAD_FILE');

  let parsed;
  try {
    parsed = await parseTrainerWorkbook(buffer, filename || '');
  } catch {
    throw badRequest(
      'That file could not be read. Please upload a valid .xlsx or .csv file.',
      'BAD_FILE'
    );
  }

  if (parsed.headerError) throw badRequest(parsed.headerError, 'BAD_HEADERS');

  // Flag emails that already exist so the preview matches what import will do.
  const emails = parsed.rows.filter((r) => !r.error).map((r) => r.email);
  const existing = await User.find({ email: { $in: emails } }).select('email').lean();
  const taken = new Set(existing.map((u) => u.email));

  const rows = parsed.rows.map((r) =>
    !r.error && taken.has(r.email)
      ? { ...r, error: 'A user with this email already exists' }
      : r
  );

  res.json({
    rows,
    truncated: Boolean(parsed.truncated),
    maxRows: MAX_ROWS,
    summary: {
      total: rows.length,
      valid: rows.filter((r) => !r.error).length,
      invalid: rows.filter((r) => r.error).length,
    },
  });
});

/**
 * POST /api/trainers/bulk  (admin)
 * Body: { trainers: [{ firstName, lastName, email, phone }], defaultPassword }
 *
 * Creates every valid trainer with ONE shared default password chosen by the
 * admin. Accounts are flagged `mustChangePassword` so a shared secret is
 * treated as a starting credential rather than a permanent one.
 *
 * Deliberately PARTIAL-SUCCESS: one bad row must not discard the other 200.
 * Every row returns as created or skipped-with-a-reason, so the admin can fix
 * only the failures and re-upload instead of guessing which rows landed.
 */
export const bulkCreateTrainers = asyncHandler(async (req, res) => {
  const { trainers, defaultPassword } = req.body;

  const created = [];
  const skipped = [];
  const pendingMail = [];

  // Hash the shared password ONCE. bcrypt is intentionally slow (~100ms), so
  // hashing per row would turn a 500-row import into a minute of CPU for no
  // benefit — the input is identical every time.
  const passwordHash = await hashPassword(defaultPassword);

  // One query for every email in the file instead of N round-trips.
  const emails = trainers.map((t) => t.email.toLowerCase());
  const existing = await User.find({ email: { $in: emails } }).select('email').lean();
  const taken = new Set(existing.map((u) => u.email));
  const seenInFile = new Set();

  for (let i = 0; i < trainers.length; i++) {
    const t = trainers[i];
    const row = t.row ?? i + 2; // spreadsheet row number when supplied
    const email = t.email.toLowerCase();
    const firstName = (t.firstName || '').trim();
    const lastName = (t.lastName || '').trim();
    const name = `${firstName} ${lastName}`.trim();

    // Listing the same person twice is a common copy/paste mistake — catch it
    // here rather than letting the unique index report it as a clash.
    if (seenInFile.has(email)) {
      skipped.push({ row, email, reason: 'Duplicate email within the file' });
      continue;
    }
    seenInFile.add(email);

    if (taken.has(email)) {
      skipped.push({ row, email, reason: 'A user with this email already exists' });
      continue;
    }

    try {
      await User.create({
        name,
        firstName,
        lastName,
        email,
        phone: (t.phone || '').trim(),
        passwordHash,
        role: 'trainer',
        mustChangePassword: true,
      });
      created.push({ row, name, email, phone: (t.phone || '').trim() });
      // Queued after the write so a mail outage can't cost us the account.
      pendingMail.push({ name, email });
    } catch (err) {
      // The unique index is the authoritative guard against a race between the
      // pre-check above and this insert.
      skipped.push({
        row,
        email,
        reason:
          err.code === 11000 ? 'A user with this email already exists' : 'Could not be created',
      });
    }
  }

  // Send welcome mail after every row is written. Sequential and failure-tolerant:
  // one bad address must not stop the rest, and none of it can fail the import.
  let emailed = 0;
  for (const m of pendingMail) {
    const mail = welcomeEmail({
      name: m.name,
      email: m.email,
      password: defaultPassword,
      loginUrl: `${env.appUrl}/login`,
    });
    const r = await sendMail({ to: m.email, ...mail });
    if (r.ok) emailed++;
  }

  recordAudit(req, {
    action: 'trainer.bulk_import',
    entity: 'trainer',
    entityName: `${created.length} trainers`,
    meta: { created: created.length, skipped: skipped.length, emailed },
  });

  res.status(201).json({
    created,
    skipped,
    emailed,
    summary: { total: trainers.length, created: created.length, skipped: skipped.length },
  });
});

// GET /api/trainers  (admin) — includes a class count per trainer
export const listTrainers = asyncHandler(async (_req, res) => {
  const trainers = await User.find({ role: 'trainer' }).sort({ createdAt: -1 }).lean();
  const counts = await Class.aggregate([
    { $group: { _id: '$trainer', classes: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.classes]));
  res.json({
    trainers: trainers.map((t) => ({ ...t, classCount: byId.get(String(t._id)) || 0 })),
  });
});

// PATCH /api/trainers/:id  (admin) — edit / activate / deactivate
export const updateTrainer = asyncHandler(async (req, res) => {
  const { name, email, password, isActive } = req.body;
  const trainer = await User.findOne({ _id: req.params.id, role: 'trainer' });
  if (!trainer) throw notFound('Trainer not found');

  if (email && email.toLowerCase() !== trainer.email) {
    const clash = await User.findOne({ email: email.toLowerCase() });
    if (clash) throw conflict('A user with this email already exists', 'EMAIL_TAKEN');
    trainer.email = email;
  }
  if (name !== undefined) trainer.name = name;
  if (typeof isActive === 'boolean') trainer.isActive = isActive;
  if (password) trainer.passwordHash = await hashPassword(password);

  await trainer.save();
  res.json({ trainer });
});
