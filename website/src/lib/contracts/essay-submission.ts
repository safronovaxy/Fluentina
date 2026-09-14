/**
 * KAN-14 — the POST /api/essays request contract.
 *
 * Deliberately narrow: this only validates that some non-empty text was
 * submitted, and guards against a pathologically large payload. It says
 * nothing about what makes a *good* essay — the product's actual
 * word-count rules (a live counter, the 150-200 recommended range, the
 * 201-300 warning, the >300 hard block and the <50 block — BR-1.1) are
 * KAN-15's job, not this story's. `content`'s `.max()` below is the seam
 * that story extends or replaces with the real word-based check; nothing
 * else in this schema should need to change for it to do that.
 *
 * `MAX_ESSAY_CONTENT_BYTES` is a blunt safety cap, not a product rule —
 * comfortably above any real essay (300 words is roughly 2,000
 * characters) so it never fires for a legitimate submission. It exists so
 * `POST /api/essays` never accepts an unbounded body while KAN-15's real
 * limit doesn't exist yet; see `src/app/api/essays/route.ts`, which
 * enforces the same number against the raw request body before it is even
 * parsed as JSON — the string-length check here and the byte-length check
 * there are two independent readings of the one number, not two different
 * limits to keep in sync by hand.
 */
import { z } from 'zod';

export const MAX_ESSAY_CONTENT_BYTES = 20_000;

export const essaySubmissionRequestSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'essay content must not be empty')
    .max(MAX_ESSAY_CONTENT_BYTES, `essay content exceeds the ${MAX_ESSAY_CONTENT_BYTES}-character safety cap`),
});

export type EssaySubmissionRequest = z.infer<typeof essaySubmissionRequestSchema>;
