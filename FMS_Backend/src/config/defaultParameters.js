/**
 * The feedback parameters a new organization starts with.
 *
 * Shared rather than copied, because this list is seeded from two places now
 * — the original single-tenant seed script and every organization the super
 * admin creates. Two copies drift, and the drift is invisible: the second
 * tenant quietly asks students a slightly different set of questions, and
 * nothing compares the two until someone tries to read both reports together.
 *
 * An organization is free to edit, reorder or remove these afterwards; they
 * are a starting point, not a schema.
 */
export const DEFAULT_PARAMETERS = [
  'Content clarity',
  "Trainer's subject knowledge",
  'Pace of the session',
  'Engagement & interaction',
  'Doubt resolution',
  'Real-world / practical examples',
  'Quality of materials',
  'Overall experience',
];
