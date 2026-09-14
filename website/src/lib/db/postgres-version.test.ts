// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  EXPECTED_POSTGRES_MAJOR,
  majorFromVersionNum,
  assertPostgresMajor,
} from './postgres-version';

describe('postgres version guard', () => {
  it('reads the major out of server_version_num', () => {
    // 16.10 -> 160010, 15.6 -> 150006, 14.11 -> 140011
    expect(majorFromVersionNum(160010)).toBe(16);
    expect(majorFromVersionNum(150006)).toBe(15);
    expect(majorFromVersionNum(140011)).toBe(14);
  });

  it('passes on the expected major, whatever the patch level', () => {
    expect(() =>
      assertPostgresMajor(EXPECTED_POSTGRES_MAJOR * 10_000, 'test'),
    ).not.toThrow();
    expect(() =>
      assertPostgresMajor(EXPECTED_POSTGRES_MAJOR * 10_000 + 42, 'test'),
    ).not.toThrow();
  });

  it('refuses an older major and says what to do about it', () => {
    // The realistic case: production turns out to predate what we develop on.
    expect(() => assertPostgresMajor(150006, 'The target database')).toThrow(
      /major version 15/,
    );
    expect(() => assertPostgresMajor(150006, 'The target database')).toThrow(
      /Migrations were NOT applied/,
    );
    // The instruction matters as much as the refusal: the shared instance
    // carries the live CMS, so the fix is to lower ours, not raise theirs.
    expect(() => assertPostgresMajor(150006, 'The target database')).toThrow(
      /Do not upgrade the shared instance/,
    );
  });

  it('refuses a newer major too', () => {
    // Not just "too old". Generated SQL is pinned to a dialect either way,
    // and an unexpected newer server is still an unverified assumption.
    expect(() => assertPostgresMajor(170004, 'The target database')).toThrow(
      /major version 17/,
    );
  });
});
