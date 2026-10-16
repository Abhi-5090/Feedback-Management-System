import { User } from '../models/User.js';
import { Membership } from '../models/Membership.js';
import { Class } from '../models/Class.js';
import { Batch } from '../models/Batch.js';
import { escapeRegex } from '../services/analyticsService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { hashPassword } from '../utils/password.js';
import { conflict, notFound, badRequest } from '../utils/ApiError.js';
import {
  parseTrainerWorkbook,
  buildTrainerTemplate,
  MAX_ROWS,
} from '../services/trainerImportService.js';
import { sendMail, welcomeEmail, addedToOrganizationEmail, resetEmail, orgFromName } from '../services/emailService.js';
import { env } from '../config/env.js';
import { recordAudit } from '../services/auditService.js';
import crypto from 'node:crypto';
import { PasswordResetToken } from '../models/PasswordResetToken.js';
import { assertWithinQuota } from '../services/quotaService.js';
import { runUnscoped } from '../tenancy/tenantContext.js';

// POST /api/trainers  (admin)
export const createTrainer = asyncHandler(async (req, res) => {
  await assertWithinQuota(req.organization?._id, 'maxUsers');

  const { name, email, password, phone, shortName } = req.body;
  const clean = email.toLowerCase();

  /* LOOKED UP ACROSS THE WHOLE PRODUCT, not just this organization.
     
     Scoped, this found nobody when the person already taught somewhere else —
     and the create that followed hit the global unique index on email and
     came back as "Duplicate entry", which tells an admin nothing about what
     to do. One person teaching at two colleges is the case the membership
     model exists for; it should be the easy path, not an error.
     
     It does mean an admin can learn that an address is already registered.
     That is the same trade every product with invitations makes, it is an
     authenticated action by someone who can already see their own staff, and
     it is audited — against a feature that is otherwise unusable. */
  const existing = await runUnscoped(() => User.findOne({ email: clean }));

  if (existing) {
    if (existing.role === 'superadmin') {
      throw conflict('That address belongs to a platform account.', 'EMAIL_TAKEN');
    }

    const already = await Membership.findOne({ user: existing._id });
    if (already) {
      throw conflict(`${existing.name} is already in this organization.`, 'ALREADY_A_MEMBER');
    }

    await Membership.create({ user: existing._id, role: 'trainer', invitedBy: req.user?._id });
    /* The tenant filter matches on this array, so the organization has to be
       added to it or the new member stays invisible to every scoped query. */
    await runUnscoped(() =>
      User.updateOne({ _id: existing._id }, { $addToSet: { organization: req.organization._id } })
    );

    recordAudit(req, {
      action: 'trainer.add_existing',
      entity: 'user',
      entityId: existing._id,
      entityName: existing.name,
      meta: { email: clean },
    });

    /* Not the welcome email: that one carries a password, and they already
       have one they use elsewhere. */
    const mail = addedToOrganizationEmail({
      name: existing.name,
      organizationName: req.organization?.name || 'your institution',
      loginUrl: `${env.appUrl}/login`,
    });
    await sendMail({ to: existing.email, ...mail, fromName: orgFromName(req) });

    return res.status(201).json({
      trainer: {
        id: String(existing._id),
        name: existing.name,
        email: existing.email,
        shortName: existing.shortName || '',
      },
      /* Says plainly that no new account was made and no password was set, so
         the admin does not go looking for one to pass on. */
      addedExisting: true,
    });
  }

  const trainer = await User.create({
    name,
    email,
    phone: (phone || '').trim(),
    // Defaults to the first word of the full name, which is how the training
    // board refers to people ("Bhargav", "Suneeta"). Stored rather than derived
    // so an admin can correct the cases where it guesses wrong.
    shortName: (shortName || String(name).trim().split(/\s+/)[0] || '').trim(),
    passwordHash: await hashPassword(password),
    role: 'trainer',
    // The admin chose this password, so it counts as issued: the trainer is
    // held at the change-password gate until they pick their own.
    mustChangePassword: true,
  });
  await Membership.create({ user: trainer._id, role: 'trainer', invitedBy: req.user?._id });

  // Fire-and-forget: a mail failure must not undo a created account.
  const mail = welcomeEmail({
    name: trainer.name,
    email: trainer.email,
    password,
    loginUrl: `${env.appUrl}/login`,
  });
  const delivery = await sendMail({ to: trainer.email, ...mail, fromName: orgFromName(req) });

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
  /* Checked ONCE for the whole batch. Importing until the ceiling is hit
     would leave the spreadsheet and the database disagreeing about what
     happened, and the admin with no clean way to retry. */
  const incoming = Array.isArray(req.body?.rows) ? req.body.rows.length : 1;
  await assertWithinQuota(req.organization?._id, 'maxUsers', incoming);

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
      const createdUser = await User.findOne({ email: row.email });
      if (createdUser) {
        await Membership.create({ user: createdUser._id, role: 'trainer', invitedBy: req.user?._id });
      }
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
    const r = await sendMail({ to: m.email, ...mail, fromName: orgFromName(req) });
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

/**
 * GET /api/trainers  (admin)
 * Query: page, limit, q, archived (reused as active|inactive|all)
 *
 * Reports each mentor's REAL deployment: how many classes they deliver and how
 * many they assist, counted from the batch rosters. The old version counted
 * `Class.trainer` — catalog ownership — which now understates every mentor who
 * is staffed per batch and misses support work entirely.
 */
export const listTrainers = asyncHandler(async (req, res) => {
  const { page, limit, q } = req.query;
  const state = req.query.archived; // 'live' → active, 'archived' → inactive

  const filter = { role: 'trainer' };
  if (state === 'live') filter.isActive = true;
  else if (state === 'archived') filter.isActive = false;
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { shortName: rx }, { phone: rx }];
  }

  const [trainers, total] = await Promise.all([
    User.find(filter)
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  const ids = trainers.map((t) => t._id);

  const [staffing, defaults] = await Promise.all([
    ids.length
      ? Batch.aggregate([
          { $match: { archivedAt: null } },
          { $unwind: '$classes' },
          {
            $facet: {
              main: [
                { $unwind: '$classes.mainTrainers' },
                { $match: { 'classes.mainTrainers': { $in: ids } } },
                {
                  $group: {
                    _id: '$classes.mainTrainers',
                    classes: { $sum: 1 },
                    batches: { $addToSet: '$_id' },
                  },
                },
                { $project: { classes: 1, batches: { $size: '$batches' } } },
              ],
              support: [
                { $unwind: '$classes.supportTrainers' },
                { $match: { 'classes.supportTrainers': { $in: ids } } },
                {
                  $group: {
                    _id: '$classes.supportTrainers',
                    classes: { $sum: 1 },
                    batches: { $addToSet: '$_id' },
                  },
                },
                { $project: { classes: 1, batches: { $size: '$batches' } } },
              ],
            },
          },
        ])
      : [],
    // Subjects naming this person as their default mentor — shown so an admin
    // knows what a deactivation would leave unstaffed.
    ids.length
      ? Class.aggregate([
          { $match: { archivedAt: null, trainer: { $in: ids } } },
          { $group: { _id: '$trainer', classes: { $sum: 1 } } },
        ])
      : [],
  ]);

  const facet = staffing[0] || { main: [], support: [] };
  const mainBy = new Map(facet.main.map((x) => [String(x._id), x]));
  const suppBy = new Map(facet.support.map((x) => [String(x._id), x]));
  const defaultBy = new Map(defaults.map((x) => [String(x._id), x.classes]));

  res.json({
    trainers: trainers.map((t) => {
      const id = String(t._id);
      const m = mainBy.get(id) || { classes: 0, batches: 0 };
      const sp = suppBy.get(id) || { classes: 0, batches: 0 };
      return {
        ...t,
        mainClassCount: m.classes,
        mainBatchCount: m.batches,
        supportClassCount: sp.classes,
        supportBatchCount: sp.batches,
        // Kept for compatibility with anything still reading a single number.
        classCount: m.classes + sp.classes,
        defaultForClasses: defaultBy.get(id) || 0,
        deployment:
          m.classes && sp.classes
            ? 'Main + Support'
            : m.classes
              ? 'Main'
              : sp.classes
                ? 'Support'
                : 'Unassigned',
      };
    }),
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

/**
 * PATCH /api/trainers/:id  (admin) — edit / activate / deactivate
 *
 * Deactivating is the closest thing to deleting a mentor: their account stops
 * working, but their name stays on every past session so the historical record
 * and the audit trail remain readable. A hard delete would orphan feedback.
 */
export const updateTrainer = asyncHandler(async (req, res) => {
  const { name, email, password, phone, shortName, isActive } = req.body;
  const trainer = await User.findOne({ _id: req.params.id, role: 'trainer' });
  if (!trainer) throw notFound('Trainer not found');

  if (email && email.toLowerCase() !== trainer.email) {
    const clash = await User.findOne({ email: email.toLowerCase() });
    if (clash) throw conflict('A user with this email already exists', 'EMAIL_TAKEN');
    trainer.email = email;
  }
  if (name !== undefined) trainer.name = name;
  if (phone !== undefined) trainer.phone = phone;
  if (shortName !== undefined) trainer.shortName = shortName;

  // Refuse to deactivate someone an OPEN batch still depends on, and name the
  // batches. Silently deactivating a mentor mid-collection leaves live sessions
  // attributed to a disabled account and no hint as to why.
  if (isActive === false && trainer.isActive) {
    const openStaffing = await Batch.find({
      status: 'open',
      archivedAt: null,
      $or: [
        { 'classes.mainTrainers': trainer._id },
        { 'classes.supportTrainers': trainer._id },
      ],
    })
      .select('name')
      .lean();
    if (openStaffing.length) {
      throw badRequest(
        `${trainer.name} is staffed on open batches — lock these first: ${openStaffing
          .map((b) => b.name)
          .join(', ')}`,
        'TRAINER_IN_OPEN_BATCH'
      );
    }
  }
  if (typeof isActive === 'boolean') trainer.isActive = isActive;

  if (password) {
    trainer.passwordHash = await hashPassword(password);
    // An admin-issued password is a starting credential, not a chosen one.
    trainer.mustChangePassword = true;
    // Revoke every session minted under the old password. Without this an
    // admin resetting a compromised account leaves the attacker's 7-day token
    // working, which defeats the point of the reset.
    trainer.tokenVersion = (trainer.tokenVersion || 0) + 1;
  }

  await trainer.save();

  recordAudit(req, {
    action: 'trainer.update',
    entity: 'trainer',
    entityId: trainer._id,
    entityName: trainer.name,
    meta: {
      passwordReset: Boolean(password),
      ...(typeof isActive === 'boolean' ? { isActive } : {}),
    },
  });

  res.json({ trainer });
});

/**
 * POST /api/trainers/:id/reset-link  (admin)
 *
 * Mints a single-use password-reset link and RETURNS it, for the admin to pass
 * on directly.
 *
 * Why this exists: /forgot-password depends on email, and email is the part of
 * a deployment most likely to be missing or misconfigured. When it is, that
 * endpoint still answers "a link is on its way" — it has to, or it becomes an
 * oracle for which addresses are registered — so a mentor who cannot receive
 * mail has no route back into their account and no way to know why. This gives
 * the admin a way to unblock them in person, over the phone, or on WhatsApp.
 *
 * The grant is the SAME kind /forgot-password issues: hashed at rest, expires
 * in RESET_TOKEN_MINUTES, single-use, and it invalidates any earlier grant.
 * Handing out a URL is no weaker than emailing one — arguably stronger, since
 * it never sits in an inbox — but it IS a credential, so the act is audited
 * with the actor's name.
 */
export const issueResetLink = asyncHandler(async (req, res) => {
  const trainer = await User.findOne({ _id: req.params.id, role: 'trainer' });
  if (!trainer) throw notFound('Trainer not found');
  if (!trainer.isActive) {
    throw badRequest('That account is deactivated — reactivate it first.', 'INACTIVE');
  }

  // Any link issued earlier stops working, so two outstanding links can never
  // both be live.
  await PasswordResetToken.updateMany(
    { user: trainer._id, usedAt: null },
    { usedAt: new Date() }
  );

  const raw = crypto.randomBytes(32).toString('hex');
  await PasswordResetToken.create({
    user: trainer._id,
    tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
    expiresAt: new Date(Date.now() + env.resetTokenMinutes * 60_000),
    requestedIp: req.ip || '',
  });

  const url = `${env.appUrl}/reset-password?token=${raw}`;

  // Try to email it as well, so the normal path still happens when it works.
  const mail = resetEmail({
    name: trainer.name,
    resetUrl: url,
    minutes: env.resetTokenMinutes,
  });
  const delivery = await sendMail({ to: trainer.email, ...mail, fromName: orgFromName(req) });

  recordAudit(req, {
    action: 'trainer.reset_link',
    entity: 'trainer',
    entityId: trainer._id,
    entityName: trainer.name,
    // The link itself is NEVER audited — an audit log is not a place to store
    // live credentials.
    meta: { emailed: Boolean(delivery.delivered), minutes: env.resetTokenMinutes },
  });

  res.json({
    ok: true,
    trainer: { id: String(trainer._id), name: trainer.name, email: trainer.email },
    resetUrl: url,
    expiresInMinutes: env.resetTokenMinutes,
    emailed: Boolean(delivery.delivered),
    notice: delivery.delivered
      ? `Emailed to ${trainer.email}. The link is single-use and expires in ${env.resetTokenMinutes} minutes.`
      : `Email is not configured, so nothing was sent. Copy this link to ${trainer.name} yourself — it is single-use and expires in ${env.resetTokenMinutes} minutes.`,
  });
});

/**
 * DELETE /api/v1/trainers/:id
 *
 * Removes a person FROM THIS ORGANIZATION, not from the product.
 *
 * That distinction is the whole reason membership is a row. The same mentor
 * may teach at another institution, and deleting their account because one
 * college let them go would silently sign them out of a job they still have —
 * and orphan that college's feedback at the same time.
 *
 * So this deletes the membership. The account itself is removed only when the
 * membership just revoked was their last one, which keeps the product from
 * accumulating accounts that belong nowhere.
 */
export const removeTrainer = asyncHandler(async (req, res) => {
  const trainer = await User.findOne({ _id: req.params.id, role: 'trainer' });
  if (!trainer) throw notFound('Mentor not found');

  const orgId = req.organization?._id;
  const staffed = await Batch.countDocuments({
    status: 'open',
    $or: [{ 'classes.mainTrainers': trainer._id }, { 'classes.supportTrainers': trainer._id }],
  });
  if (staffed > 0) {
    throw badRequest(
      `${trainer.name} is staffed on ${staffed} cohort${staffed === 1 ? '' : 's'} that ` +
        'are collecting right now. Take them off those rosters first.',
      'STAFFED_ON_OPEN'
    );
  }

  await Membership.deleteOne({ organization: orgId, user: trainer._id });

  /* Their remaining memberships decide whether the ACCOUNT survives. */
  const remaining = await runUnscoped(() =>
    Membership.countDocuments({ user: trainer._id, isActive: true })
  );

  if (remaining === 0) {
    await runUnscoped(() => User.deleteOne({ _id: trainer._id }));
  } else {
    /* Still employed elsewhere: drop only this organization from their list,
       so the tenant filter stops matching them here and keeps matching there. */
    await runUnscoped(() =>
      User.updateOne({ _id: trainer._id }, { $pull: { organization: orgId } })
    );
  }

  recordAudit(req, {
    action: 'trainer.remove',
    entity: 'user',
    entityId: trainer._id,
    entityName: trainer.name,
    meta: { accountDeleted: remaining === 0, remainingOrganizations: remaining },
  });

  res.json({ removed: true, accountDeleted: remaining === 0 });
});

/**
 * GET /api/v1/trainers/directory?q=&limit=
 *
 * Everyone on the platform an admin could add to their organization.
 *
 * THIS CROSSES THE TENANT LINE ON PURPOSE, which nothing else in the product
 * does, so it is worth saying exactly how far. These organizations are
 * colleges served by one training operation, not unrelated customers: the
 * mentors are the same people teaching at several of them, and staffing a
 * cohort means finding somebody who already exists rather than minting a
 * second account for them.
 *
 * What it returns is IDENTITY — the name and address you need to recognise a
 * colleague and add them. What it deliberately does not return is anything
 * about how they are doing elsewhere: no ratings, no feedback, no cohorts,
 * not even which other organizations they belong to. Being able to staff
 * somebody is a different thing from being able to read their performance
 * review at another college, and the first does not require the second.
 */
export const trainerDirectory = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

  /* A search, not a dump. Without a term this returns nothing rather than
     every person on the platform: a browsable list of everybody is a bigger
     thing to hand out than the ability to look somebody up, and the task here
     is always "find this person I know about". */
  if (q.length < 2) {
    return res.json({ people: [], hint: 'Type at least two characters to search.' });
  }

  const rx = new RegExp(escapeRegex(q), 'i');
  const people = await runUnscoped(() =>
    User.find({
      role: 'trainer',
      isActive: true,
      $or: [{ name: rx }, { email: rx }, { shortName: rx }],
    })
      .select('name email shortName')
      .sort({ name: 1 })
      .limit(limit)
      .lean()
  );
  if (!people.length) return res.json({ people: [] });

  /* Which of them are already here, so the list can say "already in this
     organization" instead of letting an admin click add and meet an error. */
  const mine = await Membership.find({ user: { $in: people.map((p) => p._id) } })
    .select('user')
    .lean();
  const here = new Set(mine.map((m) => String(m.user)));

  res.json({
    people: people.map((p) => ({
      id: String(p._id),
      name: p.name,
      email: p.email,
      shortName: p.shortName || '',
      alreadyHere: here.has(String(p._id)),
    })),
  });
});

/**
 * POST /api/v1/trainers/:id/add
 *
 * Add somebody who already exists to this organization, by id.
 *
 * Separate from creating a mentor because it is a different act: nothing is
 * minted, no password is issued, and the person already has an account they
 * use. Collapsing the two would mean a create endpoint whose behaviour
 * depends on whether a stranger happens to exist.
 */
export const addExistingTrainer = asyncHandler(async (req, res) => {
  await assertWithinQuota(req.organization?._id, 'maxUsers');

  const person = await runUnscoped(() => User.findById(req.params.id));
  if (!person || person.role !== 'trainer' || !person.isActive) {
    throw notFound('That person is not available to add');
  }

  const already = await Membership.findOne({ user: person._id });
  if (already) throw conflict(`${person.name} is already in this organization.`, 'ALREADY_A_MEMBER');

  await Membership.create({ user: person._id, role: 'trainer', invitedBy: req.user?._id });
  await runUnscoped(() =>
    User.updateOne({ _id: person._id }, { $addToSet: { organization: req.organization._id } })
  );

  recordAudit(req, {
    action: 'trainer.add_existing',
    entity: 'user',
    entityId: person._id,
    entityName: person.name,
    meta: { email: person.email, via: 'directory' },
  });

  const mail = addedToOrganizationEmail({
    name: person.name,
    organizationName: req.organization?.name || 'your institution',
    loginUrl: `${env.appUrl}/login`,
  });
  await sendMail({ to: person.email, ...mail, fromName: orgFromName(req) });

  res.status(201).json({
    trainer: { id: String(person._id), name: person.name, email: person.email },
    addedExisting: true,
  });
});
