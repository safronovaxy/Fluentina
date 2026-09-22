#!/usr/bin/env bash
set -euo pipefail

# KAN-30 — a throwaway self-signed certificate for the one thing a plain-HTTP
# Playwright run can never prove: that a browser actually stores our
# `__Host-`-prefixed session cookie. WebKit refuses that cookie (and any
# `Secure` cookie) over plain HTTP even on localhost — see
# tests/guest-session.spec.ts's own comment for the probe that established
# this — so the e2e run needs a real TLS connection in front of it, not a
# trusted one. A self-signed cert is sufficient: Safari stores the cookie
# over an encrypted connection even when the certificate itself is
# untrusted (already measured, not assumed here).
#
# Deliberately a plain `openssl` call, not a new npm dependency (mkcert,
# devcert, etc.) — this only needs to exist for the lifetime of one CI job
# or one local run, and openssl is already present on the ubuntu-latest
# runner and on every developer machine this repo targets.

OUT_DIR="${1:-.tls}"
mkdir -p "$OUT_DIR"

openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "$OUT_DIR/localhost-key.pem" \
  -out "$OUT_DIR/localhost-cert.pem" \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo "Generated $OUT_DIR/localhost-cert.pem and $OUT_DIR/localhost-key.pem (self-signed, 1 day)"
