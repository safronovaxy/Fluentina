#!/usr/bin/env node
/**
 * KAN-30 — terminates TLS in front of the locally built app, using the
 * self-signed cert `generate-tls-cert.sh` produces, and forwards everything
 * else (method, headers, body, streamed responses) to the plain-HTTP server
 * `next start` already runs.
 *
 * Deliberately a bare `node:http`/`node:https` proxy, not a new npm
 * dependency — nothing here needs to inspect or rewrite the traffic.
 * `lib/guest-session-cookie.ts` always sets `Secure` regardless of what
 * protocol the app itself sees, so the only thing that has to change for the
 * browser to store the session cookie is the connection between the browser
 * and this proxy — the connection from here to the app can stay plain HTTP.
 * The Host header is forwarded untouched (not rewritten to the upstream
 * host:port) so Next.js's own absolute-URL redirects (next-intl's locale
 * negotiation) keep pointing at this proxy's origin instead of leaking the
 * upstream port to the browser.
 */
import { createServer as createHttpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { readFileSync } from 'node:fs';

const PROXY_PORT = Number(process.env.TLS_PROXY_PORT ?? 8443);
const TARGET_PORT = Number(process.env.TLS_PROXY_TARGET_PORT ?? 3000);
const TARGET_HOST = process.env.TLS_PROXY_TARGET_HOST ?? 'localhost';
const CERT_PATH = process.env.TLS_PROXY_CERT ?? '.tls/localhost-cert.pem';
const KEY_PATH = process.env.TLS_PROXY_KEY ?? '.tls/localhost-key.pem';

function forward(clientReq, clientRes) {
  const upstreamReq = httpRequest(
    {
      host: TARGET_HOST,
      port: TARGET_PORT,
      method: clientReq.method,
      path: clientReq.url,
      headers: clientReq.headers,
    },
    (upstreamRes) => {
      clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(clientRes);
    },
  );
  upstreamReq.on('error', (err) => {
    if (!clientRes.headersSent) clientRes.writeHead(502);
    clientRes.end(`TLS proxy: upstream request failed: ${err.message}`);
  });
  clientReq.pipe(upstreamReq);
}

const server = createHttpsServer(
  { cert: readFileSync(CERT_PATH), key: readFileSync(KEY_PATH) },
  forward,
);

server.on('error', (err) => {
  console.error(`TLS proxy failed to start: ${err.message}`);
  process.exit(1);
});

server.listen(PROXY_PORT, () => {
  console.log(
    `TLS proxy listening on https://localhost:${PROXY_PORT} -> http://${TARGET_HOST}:${TARGET_PORT}`,
  );
});
