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

const run = (over = {}) =>
  assertDestructiveAllowed({
    uri: 'mongodb+srv://u:p@cluster.mongodb.net/fms_production?retryWrites=true',
    action: 'delete everything',
    argv: ['node', 'script.js', '--yes'],
    nodeEnv: 'development',
    ...over,
  });

describe('databaseFromUri', () => {
  test.each([
    ['mongodb+srv://u:p@c.mongodb.net/fms_prod?retryWrites=true&w=majority', 'fms_prod'],
    ['mongodb://localhost:27017/fms_dev', 'fms_dev'],
    ['mongodb://a:b@h1:27017,h2:27017/fms_rs?replicaSet=rs0', 'fms_rs'],
    ['mongodb+srv://u:p@c.mongodb.net/with%20space', 'with space'],
  ])('reads the database out of %s', (uri, expected) => {
    expect(databaseFromUri(uri)).toBe(expected);
  });

  test.each([
    ['mongodb://localhost:27017', 'no database at all'],
    ['mongodb+srv://u:p@c.mongodb.net/?retryWrites=true', 'an empty path'],
    ['', 'an empty string'],
    [undefined, 'undefined'],
  ])('returns null for %s (%s)', (uri) => {
    expect(databaseFromUri(uri)).toBeNull();
  });
});

describe('redactUri', () => {
  test('removes the password before anything is printed', () => {
    expect(redactUri('mongodb+srv://user:sup3rs3cret@c.mongodb.net/fms')).toBe(
      'mongodb+srv://user:<redacted>@c.mongodb.net/fms'
    );
  });

  test('leaves a URI with no credentials alone', () => {
    expect(redactUri('mongodb://localhost:27017/fms')).toBe('mongodb://localhost:27017/fms');
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
    expect(host).not.toContain('p@');
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
