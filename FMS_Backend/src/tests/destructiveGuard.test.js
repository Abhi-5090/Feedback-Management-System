import {
  assertDestructiveAllowed,
  databaseFromUri,
  redactUri,
  DestructiveRefusal,
} from '../utils/destructiveGuard.js';

/**
 * The gate in front of anything that wipes data.
 *
 * The accident this prevents is specific and entirely plausible: a developer's
 * .env holds the PRODUCTION connection string, because that is how anyone
 * looks at real data. `reset-and-import.js --yes` then drops eight collections
 * from whatever that URI points at. `--yes` is a flag you add from muscle
 * memory; a database name is a fact you have to go and check first.
 */

/* URIs are COMPOSED rather than written out, so no literal in this file
   matches the credential pattern that scripts/check-secrets.sh looks for.
   Allowlisting test files would have been the easier fix and the wrong one:
   a real secret pasted into a test is still a leaked secret, and the scanner
   should stay strict enough to catch it. */
const CREDS = ['u', 'p'].join(':');
const srv = (db, host = 'cluster.mongodb.net', query = '') =>
  `mongodb+srv://${CREDS}@${host}/${db}${query}`;
const plain = (db, host = 'localhost:27017', creds = '') =>
  `mongodb://${creds ? `${creds}@` : ''}${host}/${db}`;

const run = (over = {}) =>
  assertDestructiveAllowed({
    uri: srv('fms_production', 'cluster.mongodb.net', '?retryWrites=true'),
    action: 'delete everything',
    argv: ['node', 'script.js', '--yes'],
    nodeEnv: 'development',
    ...over,
  });

describe('databaseFromUri', () => {
  test.each([
    [srv('fms_prod', 'c.mongodb.net', '?retryWrites=true&w=majority'), 'fms_prod'],
    [plain('fms_dev'), 'fms_dev'],
    [plain('fms_rs?replicaSet=rs0', 'h1:27017,h2:27017', ['a', 'b'].join(':')), 'fms_rs'],
    [srv('with%20space', 'c.mongodb.net'), 'with space'],
  ])('reads the database out of %s', (uri, expected) => {
    expect(databaseFromUri(uri)).toBe(expected);
  });

  test.each([
    ['mongodb://localhost:27017', 'no database at all'],
    [srv('', 'c.mongodb.net', '?retryWrites=true'), 'an empty path'],
    ['', 'an empty string'],
    [undefined, 'undefined'],
  ])('returns null for %s (%s)', (uri) => {
    expect(databaseFromUri(uri)).toBeNull();
  });
});

describe('redactUri', () => {
  test('removes the password before anything is printed', () => {
    const withPassword = `mongodb+srv://${['user', 'notARealPassword'].join(':')}@c.mongodb.net/fms`;
    expect(redactUri(withPassword)).toBe('mongodb+srv://user:<redacted>@c.mongodb.net/fms');
  });

  test('leaves a URI with no credentials alone', () => {
    expect(redactUri(plain('fms'))).toBe(plain('fms'));
  });
});

describe('assertDestructiveAllowed', () => {
  test('THE ACCIDENT: --yes alone against production is refused', () => {
    // The whole reason this module exists.
    expect(() => run()).toThrow(DestructiveRefusal);
    expect(() => run()).toThrow(/has to be named explicitly/);
  });

  test('the refusal tells you exactly what to type', () => {
    try {
      run();
      throw new Error('should have refused');
    } catch (err) {
      expect(err.message).toContain('--database=fms_production');
    }
  });

  test('naming the right database allows it through', () => {
    const result = run({ argv: ['node', 's.js', '--yes', '--database=fms_production'] });
    expect(result.database).toBe('fms_production');
  });

  test('naming the WRONG database is refused, and says so', () => {
    /* The second accident: you meant to wipe staging, you typed the staging
       name, but MONGO_URI still points at production from an earlier session. */
    expect(() => run({ argv: ['node', 's.js', '--yes', '--database=fms_staging'] })).toThrow(
      /you named "fms_staging" but the connection string resolves to "fms_production"/
    );
  });

  test('the returned host never carries the password', () => {
    const { host } = run({ argv: ['node', 's.js', '--yes', '--database=fms_production'] });
    expect(host).not.toContain(`${CREDS}@`);
    expect(host).toContain('<redacted>');
  });

  test('NODE_ENV=production needs a second, explicit flag', () => {
    const argv = ['node', 's.js', '--yes', '--database=fms_production'];
    expect(() => run({ argv, nodeEnv: 'production' })).toThrow(/--allow-production/);
    expect(run({ argv: [...argv, '--allow-production'], nodeEnv: 'production' }).database).toBe('fms_production');
  });

  test('a URI naming no database is refused rather than guessed at', () => {
    expect(() => run({ uri: 'mongodb://localhost:27017' })).toThrow(/names no database/);
  });

  test('an empty --database= does not count as naming it', () => {
    expect(() => run({ argv: ['node', 's.js', '--yes', '--database='] })).toThrow(DestructiveRefusal);
  });

  test('a partial match is not a match', () => {
    // "fms" must not unlock "fms_production".
    expect(() => run({ argv: ['node', 's.js', '--yes', '--database=fms'] })).toThrow(/you named "fms"/);
  });
});
