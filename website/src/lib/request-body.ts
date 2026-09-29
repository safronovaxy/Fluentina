import 'server-only';

import type { NextRequest, NextResponse } from 'next/server';
import { MAX_REQUEST_BODY_BYTES } from '@/lib/contracts/essay-submission';
import { rejectionResponse } from '@/lib/rejection-response';

/**
 * Reads `request`'s body as UTF-8 text, rejecting once the running total of
 * bytes actually read exceeds `limitBytes` — without ever buffering more than
 * `limitBytes` plus one chunk.
 *
 * KAN-20: the same streaming guard `POST /api/essays` uses (its own private
 * `readBodyWithinLimit`, whose round-2 review comment carries the full case:
 * `request.text()` buffers the ENTIRE body regardless of size, and a chunked
 * request with no `Content-Length` sails past a header pre-check). It is
 * copied here, not imported, because that copy is private to a route this
 * story does not touch; the two are the same function and should be folded
 * into this module in a separate change.
 */
export async function readBodyWithinLimit(
  request: NextRequest,
  limitBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const reader = request.body?.getReader();
  if (!reader) return { ok: true, text: '' };

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limitBytes) {
      await reader.cancel();
      return { ok: false };
    }
    chunks.push(value);
  }

  return { ok: true, text: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8') };
}

/**
 * The whole body guard `POST /api/essays` applies, in the order it applies it,
 * for the auth routes: the `Content-Length` pre-check (a cheap early exit for a
 * caller that reports its size honestly), then the streaming byte count (the
 * authority for a lying, absent or chunked one), then `JSON.parse`. Returns the
 * parsed value, or the rejection response to send.
 *
 * `MAX_REQUEST_BODY_BYTES` is the essay guard's own constant, reused as the
 * brief for this story directs. It is far larger than a credentials body needs
 * (a few hundred bytes); it is a transport safety cap, not a schema bound —
 * the schemas bound the fields.
 *
 * A rejected oversized upload sends `Connection: close`, so a client still
 * mid-upload cannot hold the socket for the keep-alive window merely by
 * continuing to send bytes nobody will read (the KAN-25 measurement recorded
 * in the essays route).
 */
export async function readBoundedJsonBody(
  request: NextRequest,
): Promise<{ ok: true; json: unknown } | { ok: false; response: NextResponse }> {
  const tooLarge = (): { ok: false; response: NextResponse } => {
    const response = rejectionResponse('bodyTooLarge', 413, 'request body exceeds the safety limit');
    response.headers.set('Connection', 'close');
    return { ok: false, response };
  };

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) return tooLarge();

  const body = await readBodyWithinLimit(request, MAX_REQUEST_BODY_BYTES);
  if (!body.ok) return tooLarge();

  try {
    return { ok: true, json: JSON.parse(body.text) };
  } catch {
    return { ok: false, response: rejectionResponse('invalidJson', 400, 'invalid JSON body') };
  }
}
