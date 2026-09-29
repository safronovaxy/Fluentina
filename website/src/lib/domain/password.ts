import 'server-only';

/**
 * KAN-20 — password hashing: scrypt from `node:crypto`, in a self-describing
 * format.
 *
 * FORMAT: `scrypt$N=32768,r=8,p=1$<salt-b64>$<hash-b64>`. The parameters are
 * IN the string, so raising N — or moving to argon2id — later leaves every
 * existing row verifiable with the parameters it was written with, and rows
 * migrate lazily (rehash on the next successful login, below). Without
 * embedded parameters the only remedy is a forced global password reset, which
 * depends on two stories (password reset, email delivery) that do not exist.
 *
 * PARAMETERS. N=2^15, r=8, p=1, a 16-byte per-user random salt and a 32-byte
 * output. `maxmem` is passed EXPLICITLY, and that line is load-bearing: scrypt
 * at N=2^15, r=8 needs a little over 32 MiB, and Node's default `maxmem` is
 * 32 MiB, so without it every call throws `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`.
 * Someone raising N later without also raising `SCRYPT_MAXMEM_BYTES` ships a
 * registration endpoint that 500s on every request. `128 * r * (N + 2 + p)` is
 * the memory scrypt needs; `assertWithinMemoryBudget` refuses parameters that
 * exceed the budget with a message that says so, rather than the driver's.
 *
 * Every hash costs ~90 ms of CPU and 32 MiB on a libuv threadpool thread
 * (`crypto.scrypt` is asynchronous, so it does not block the event loop, but
 * it does occupy the pool). Operational note, not a code change: recommend
 * `UV_THREADPOOL_SIZE=2` on the Cloud Run service — it bounds concurrent
 * scrypt memory to 2 x 32 MiB inside a 512 Mi instance, at the price of
 * queueing when several sign-ins land at once on one CPU. That is a deployment
 * setting nobody has made.
 *
 * INPUT NORMALISATION. The password is NFKC-normalised before hashing, and
 * `lib/contracts/auth.ts` counts length on the same form. The same German word
 * typed on two keyboards, or pasted from a PDF, can be a different byte
 * sequence (precomposed `ü` vs `u` + a combining diaeresis); without
 * normalisation a user could set a password on one device and be unable to
 * enter it on another. This is not recorded in the hash string, so it is
 * effectively part of the format: changing it later makes existing rows
 * unverifiable, exactly the situation self-describing parameters exist to
 * avoid. Settled now, before the first row exists.
 *
 * COMPARISON is `crypto.timingSafeEqual`, never `===`.
 *
 * NOT CLAIMED: constant-time login. See `lib/domain/login.ts` for what is and
 * is not claimed about the unknown-email path.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_KEY_BYTES = 32;
/** See the module comment: without this, N=2^15 throws ERR_CRYPTO_INVALID_SCRYPT_PARAMS. Raise it BEFORE raising N. */
const SCRYPT_MAXMEM_BYTES = 64 * 1024 * 1024;

interface ScryptParams {
  readonly N: number;
  readonly r: number;
  readonly p: number;
}

const CURRENT_PARAMS: ScryptParams = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P };

const STORED_HASH_PATTERN = /^scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;

function preparePassword(password: string): string {
  return password.normalize('NFKC');
}

function memoryRequired({ N, r, p }: ScryptParams): number {
  return 128 * r * (N + 2 + p);
}

function assertWithinMemoryBudget(params: ScryptParams): void {
  const isPowerOfTwo = params.N >= 2 && (params.N & (params.N - 1)) === 0;
  if (!isPowerOfTwo || params.r < 1 || params.p < 1) {
    throw new Error('password hash carries invalid scrypt parameters');
  }
  if (memoryRequired(params) > SCRYPT_MAXMEM_BYTES) {
    throw new Error(
      'password hash needs more scrypt memory than SCRYPT_MAXMEM_BYTES allows — raise the constant in ' +
        'lib/domain/password.ts before raising N',
    );
  }
}

function deriveKey(password: string, salt: Buffer, keyBytes: number, params: ScryptParams): Promise<Buffer> {
  assertWithinMemoryBudget(params);
  return new Promise((resolve, reject) => {
    scrypt(
      preparePassword(password),
      salt,
      keyBytes,
      { N: params.N, r: params.r, p: params.p, maxmem: SCRYPT_MAXMEM_BYTES },
      (err, derived) => (err ? reject(err) : resolve(derived)),
    );
  });
}

function formatHash(params: ScryptParams, salt: Buffer, key: Buffer): string {
  return `scrypt$N=${params.N},r=${params.r},p=${params.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

interface ParsedHash {
  readonly params: ScryptParams;
  readonly salt: Buffer;
  readonly key: Buffer;
}

function parseHash(stored: string): ParsedHash {
  const match = STORED_HASH_PATTERN.exec(stored);
  if (!match) throw new Error('stored password hash is not in the scrypt$N=..,r=..,p=..$salt$hash format');
  const [, n, r, p, salt, key] = match;
  const keyBuffer = Buffer.from(key, 'base64');
  if (keyBuffer.length === 0) throw new Error('stored password hash has an empty derived key');
  return {
    params: { N: Number(n), r: Number(r), p: Number(p) },
    salt: Buffer.from(salt, 'base64'),
    key: keyBuffer,
  };
}

/** Hashes a password with the CURRENT parameters and a fresh random salt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const key = await deriveKey(password, salt, SCRYPT_KEY_BYTES, CURRENT_PARAMS);
  return formatHash(CURRENT_PARAMS, salt, key);
}

export interface PasswordVerification {
  readonly valid: boolean;
  /** True when the stored hash was written with parameters other than the current ones. Only meaningful when `valid`. */
  readonly needsRehash: boolean;
}

/**
 * Verifies `password` against `stored` using the parameters EMBEDDED in
 * `stored`, and performs exactly one scrypt derivation. A malformed or
 * unsupported stored value throws — that is a corrupt row or a mis-set
 * constant, and it should be loud, not a silent "wrong password".
 */
export async function verifyPassword(password: string, stored: string): Promise<PasswordVerification> {
  const parsed = parseHash(stored);
  const derived = await deriveKey(password, parsed.salt, parsed.key.length, parsed.params);
  const valid = derived.length === parsed.key.length && timingSafeEqual(derived, parsed.key);
  const needsRehash =
    parsed.params.N !== CURRENT_PARAMS.N ||
    parsed.params.r !== CURRENT_PARAMS.r ||
    parsed.params.p !== CURRENT_PARAMS.p ||
    parsed.key.length !== SCRYPT_KEY_BYTES;
  return { valid, needsRehash };
}

/**
 * A fixed hash, in the current format and parameters, that no password
 * derives to. Login verifies against this when the email matches no user, so
 * that path performs the same single scrypt derivation as a wrong password —
 * see `lib/domain/login.ts`.
 *
 * Built from the CURRENT constants and fixed bytes, with no scrypt call: it
 * follows a parameter change automatically (a hard-coded string would keep the
 * old cost and make unknown-email cheaper than wrong-password the day N is
 * raised), and computing it lazily would put a second scrypt on the first
 * unknown-email login.
 */
export const DUMMY_PASSWORD_HASH = formatHash(
  CURRENT_PARAMS,
  Buffer.alloc(SCRYPT_SALT_BYTES, 0x5a),
  Buffer.alloc(SCRYPT_KEY_BYTES, 0xa5),
);
