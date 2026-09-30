import 'server-only';

import type { NextRequest, NextResponse } from 'next/server';
import { MAX_REQUEST_BODY_BYTES } from '@/lib/contracts/essay-submission';
import { rejectionResponse } from '@/lib/rejection-response';

/**
 * Reads `request`'s body as UTF-8 text, rejecting once the running total of
 * bytes actually read exceeds `limitBytes` — without ever buffering more than
 * `limitBytes` plus one chunk.
 *
 * Round-2 review (of `POST /api/essays`, where this was written): the
 * `Content-Length` pre-check in `readBoundedJsonBody` is a cheap early exit for
 * a caller that reports its size honestly, but `request.text()` buffers the
 * ENTIRE body into memory before handing back a single string, regardless of
 * size — and a request sent with chunked transfer encoding and no
 * `Content-Length` at all (the default when a body is streamed, not a crafted
 * edge case) sailed straight past that check and into `request.text()`, which
 * resident-buffers up to Cloud Run's own 32MiB request ceiling before any
 * byte-length check ever saw a number. At 512Mi and the platform's default
 * concurrency of 80, a dozen of those in parallel exhausts the instance and
 * every other request routed to it starts failing. Reading the body's own
 * stream reader chunk-by-chunk, and cancelling it the moment the running total
 * crosses the limit, bounds resident memory at `limitBytes` plus one chunk no
 * matter what any header claims or how the body is transferred.
 *
 * KAN-52: this was two copies — this one (written for the auth routes, KAN-20,
 * as a copy because the original was private to `POST /api/essays`) and that
 * route's own. The route now imports `readBoundedJsonBody` below and its copy is
 * gone; the reasoning above and in `readBoundedJsonBody` is what was written out
 * at the route's two call sites, carried here rather than lost.
 */
export async function readBodyWithinLimit(
  request: NextRequest,
  limitBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const reader = request.body?.getReader();
  // No body stream at all (e.g. a GET-shaped request with no body) — an empty
  // string is exactly what request.text() would have returned too.
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
 * shared with the auth routes: the `Content-Length` pre-check (a cheap early
 * exit for a caller that reports its size honestly, so it is never buffered at
 * all), then the streaming byte count (the authority for a lying, absent,
 * non-numeric or chunked one — the pre-check is an optimisation for the
 * honestly-reported case, not a replacement for it), then `JSON.parse`. Returns
 * the parsed value, or the rejection response to send.
 *
 * The streaming count is enforced against bytes actually read off the wire,
 * before the body is parsed, specifically so a pathologically large payload
 * never reaches `JSON.parse` or the database — see `readBodyWithinLimit` for
 * why this streams rather than calling `request.text()`.
 *
 * `MAX_REQUEST_BODY_BYTES` is the essay guard's own constant. It is far larger
 * than a credentials body needs (a few hundred bytes); it is a transport safety
 * cap, not a schema bound — the schemas bound the fields. It is likewise NOT
 * the product's word-count rule (KAN-15 owns that, against `content` itself,
 * well below this number — see `essaySubmissionRequestSchema`'s own comment),
 * and is deliberately far more generous than any real essay could ever need.
 *
 * Both oversize rejections are one `reason` (`bodyTooLarge`): a client can't
 * act on which of the two guards caught it, only that its body was too large
 * (see rejection-reason.ts's own comment on why this is one code, not two, and
 * the essays route tests for the disjoint coverage of each guard).
 *
 * A rejected oversized upload sends `Connection: close` (KAN-25). Otherwise its
 * socket is left held open for up to five minutes — measured directly against
 * the deployed build: 30 requests against this class of guard left 28 sockets
 * sitting in a wait state, against zero on the no-cookie path (which never
 * reads the body at all). Telling the runtime to close the connection after
 * this response, rather than holding it open for keep-alive reuse, is the
 * verified fix: a client still mid-upload cannot hold the socket for the rest
 * of that window merely by continuing to send bytes nobody is going to read.
 * The streaming guard is the one that measurement was actually run against.
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
