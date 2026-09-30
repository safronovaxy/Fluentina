/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { randomBytes, scryptSync } from 'node:crypto';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './password';

const FORMAT = /^scrypt\$N=32768,r=8,p=1\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$/;

/** A hash in the documented format written with parameters other than the current ones, built independently of the module under test. */
function legacyHash(password: string, N: number, r = 8, p = 1): string {
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize('NFKC'), salt, 32, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$N=${N},r=${r},p=${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

describe('hashPassword — self-describing scrypt', () => {
  it('writes scrypt$N=32768,r=8,p=1$<salt-b64>$<hash-b64>, with the parameters IN the string', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(FORMAT);
    expect(hash.split('$')).toHaveLength(4);
  });

  it('uses a 16-byte salt and a 32-byte derived key', async () => {
    const [, , salt, key] = (await hashPassword('correct horse battery staple')).split('$');
    expect(Buffer.from(salt, 'base64')).toHaveLength(16);
    expect(Buffer.from(key, 'base64')).toHaveLength(32);
  });

  it('salts per hash: the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashPassword('same password'), hashPassword('same password')]);
    expect(a).not.toBe(b);
  });

  it('does not contain the password', async () => {
    expect(await hashPassword('hunter2hunter2')).not.toContain('hunter2');
  });

  // N=2^15, r=8 needs a little over 32 MiB, Node's default maxmem. This proves
  // the precondition of the explicit `maxmem` in the module: on this Node, the
  // bare call the module would make WITHOUT it throws — so the hashing tests
  // above passing is what shows the explicit maxmem is doing its job.
  it('needs the explicit maxmem: the same parameters without it throw ERR_CRYPTO_INVALID_SCRYPT_PARAMS', () => {
    expect(() => scryptSync('x', randomBytes(16), 32, { N: 32768, r: 8, p: 1 })).toThrow(/memory limit|ERR_CRYPTO_INVALID_SCRYPT_PARAMS/);
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect((await verifyPassword('correct horse battery staple', hash)).valid).toBe(true);
    expect((await verifyPassword('correct horse battery stapleX', hash)).valid).toBe(false);
    expect((await verifyPassword('', hash)).valid).toBe(false);
  });

  it('does not flag a current-parameter hash for rehash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toEqual({ valid: true, needsRehash: false });
  });

  it('verifies a hash written with OTHER parameters using the ones embedded in it, and flags it for rehash', async () => {
    const stored = legacyHash('an old password', 2 ** 14);
    expect(await verifyPassword('an old password', stored)).toEqual({ valid: true, needsRehash: true });
    expect((await verifyPassword('not the old password', stored)).valid).toBe(false);
  });

  it.each([
    ['N', legacyHash('pw pw pw pw pw', 2 ** 13)],
    ['r', legacyHash('pw pw pw pw pw', 2 ** 14, 4)],
    ['p', legacyHash('pw pw pw pw pw', 2 ** 14, 8, 2)],
  ])('flags a hash whose %s differs from the current parameters', async (_param, stored) => {
    expect(await verifyPassword('pw pw pw pw pw', stored)).toEqual({ valid: true, needsRehash: true });
  });

  it('NFKC-normalises: composed and decomposed forms of the same German password verify against each other', async () => {
    const composed = 'Grüße aus Köln, Übung!';
    const decomposed = composed.normalize('NFD');
    expect(decomposed).not.toBe(composed);
    const hash = await hashPassword(composed);
    expect((await verifyPassword(decomposed, hash)).valid).toBe(true);
  });

  it.each([
    ['not a hash at all', 'plaintext-password'],
    ['the wrong algorithm', 'bcrypt$N=32768,r=8,p=1$c2FsdA==$aGFzaA=='],
    ['missing parameters', 'scrypt$c2FsdA==$aGFzaA=='],
    ['an empty derived key', 'scrypt$N=32768,r=8,p=1$c2FsdA==$'],
    ['a fixture placeholder', 'fixture-not-a-real-hash'],
  ])('throws on a stored value that is %s, rather than answering "wrong password"', async (_label, stored) => {
    await expect(verifyPassword('anything', stored)).rejects.toThrow();
  });

  it('throws, with a message naming the constant, when embedded parameters exceed the memory budget', async () => {
    const tooBig = 'scrypt$N=1048576,r=8,p=1$c2FsdA==$aGFzaA==';
    await expect(verifyPassword('anything', tooBig)).rejects.toThrow(/SCRYPT_MAXMEM_BYTES/);
  });

  it('throws on a non-power-of-two N', async () => {
    await expect(verifyPassword('anything', 'scrypt$N=30000,r=8,p=1$c2FsdA==$aGFzaA==')).rejects.toThrow(/invalid scrypt parameters/);
  });
});

describe('DUMMY_PASSWORD_HASH — what unknown-email login verifies against', () => {
  it('is in the current format with the current parameters, so it costs what a real verification costs', () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(FORMAT);
  });

  it('is verifiable (it runs a full derivation) and matches nothing', async () => {
    for (const candidate of ['', 'password', 'correct horse battery staple', DUMMY_PASSWORD_HASH]) {
      expect((await verifyPassword(candidate, DUMMY_PASSWORD_HASH)).valid).toBe(false);
    }
  });

  it('does not flag itself for rehash', async () => {
    expect((await verifyPassword('x', DUMMY_PASSWORD_HASH)).needsRehash).toBe(false);
  });
});
