/**
 * A gate in front of anything that deletes or rewrites data in bulk.
 *
 * WHAT WENT WRONG WITHOUT IT. `reset-and-import.js` drops eight collections
 * and its only gate is `--yes`. Whatever is in MONGO_URI is what it wipes —
 * and a developer's `.env` holds the PRODUCTION connection string, because
 * that is how anyone looks at real data. One `--yes` in the wrong terminal and
 * the live database is gone. The backup it writes first is real, but restoring
 * it is a bad morning that should never have to start.
 *
 * THE GATE. You must TYPE the name of the database you are about to destroy:
 *
 *     node src/scripts/reset-and-import.js --yes --database=fms_staging
 *
 * The name must match the database the URI actually resolves to. That single
 * requirement removes the entire class of accident, because the dangerous
 * command is no longer a flag you can add from muscle memory — it is a fact you
 * have to go and check first. It is the same reason `DROP DATABASE` in a
 * serious console makes you type the name.
 *
 * Production additionally requires --allow-production, so that even the right
 * name typed deliberately cannot be a reflex.
 */

/** The database a Mongo connection string resolves to, or null. */
export function databaseFromUri(uri) {
  const raw = String(uri || '');
  if (!raw) return null;
  // Strip scheme, then credentials/host, then query — what is left is the path.
  const afterScheme = raw.replace(/^mongodb(\+srv)?:\/\//i, '');
  const slash = afterScheme.indexOf('/');
  if (slash === -1) return null;
  const path = afterScheme.slice(slash + 1).split('?')[0];
  return path ? decodeURIComponent(path) : null;
}

/** Hide the password before a URI is printed or written anywhere. */
export const redactUri = (uri) => String(uri || '').replace(/\/\/([^:/@]+):([^@]*)@/, '//$1:<redacted>@');

export class DestructiveRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = 'DestructiveRefusal';
  }
}

/**
 * Throw unless this destructive run has been explicitly authorised.
 *
 * @param {object}   opts
 * @param {string}   opts.uri       the connection string about to be used
 * @param {string}   opts.action    human description, e.g. "wipe 8 collections"
 * @param {string[]} opts.argv      process.argv (injected so it can be tested)
 * @param {string}   opts.nodeEnv   process.env.NODE_ENV
 * @returns {{ database: string, host: string }}
 */
export function assertDestructiveAllowed({ uri, action, argv = process.argv, nodeEnv = process.env.NODE_ENV } = {}) {
  const database = databaseFromUri(uri);
  if (!database) {
    throw new DestructiveRefusal(
      `Refusing to ${action}: the connection string names no database, so there is nothing to confirm against.`
    );
  }

  const flag = argv.find((a) => a.startsWith('--database='));
  const named = flag ? flag.slice('--database='.length) : null;

  if (!named) {
    throw new DestructiveRefusal(
      `Refusing to ${action} on "${database}".\n` +
        `  This is destructive and the target has to be named explicitly:\n` +
        `      --database=${database}\n` +
        `  Check that is the database you mean before you type it.`
    );
  }

  if (named !== database) {
    throw new DestructiveRefusal(
      `Refusing to ${action}: you named "${named}" but the connection string resolves to "${database}".\n` +
        `  One of the two is wrong — most likely MONGO_URI points somewhere you did not expect.`
    );
  }

  if (nodeEnv === 'production' && !argv.includes('--allow-production')) {
    throw new DestructiveRefusal(
      `Refusing to ${action} on "${database}" with NODE_ENV=production.\n` +
        `  Add --allow-production if that is genuinely what you intend.`
    );
  }

  return { database, host: redactUri(uri) };
}
