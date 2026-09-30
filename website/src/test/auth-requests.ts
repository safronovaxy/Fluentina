/**
 * Test-only request builders and response readers for the KAN-20 route suites.
 */
import { NextRequest } from 'next/server';

export const ORIGIN_HEADERS = { origin: 'http://localhost:3000', host: 'localhost:3000' } as const;

/** Same two-hop production proxy shape `clientIp` is written against. */
export function xff(ip: string): Record<string, string> {
  return { 'x-forwarded-for': `${ip}, 34.120.0.1` };
}

export function jsonPost(
  path: string,
  body: unknown,
  options: { cookies?: Record<string, string>; headers?: Record<string, string> } = {},
): NextRequest {
  const cookie = Object.entries(options.cookies ?? {})
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  return new NextRequest(new URL(`http://localhost:3000${path}`), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...ORIGIN_HEADERS,
      ...(cookie ? { cookie } : {}),
      ...options.headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export function bodilessPost(path: string, options: { cookies?: Record<string, string>; headers?: Record<string, string> } = {}): NextRequest {
  const cookie = Object.entries(options.cookies ?? {})
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  return new NextRequest(new URL(`http://localhost:3000${path}`), {
    method: 'POST',
    headers: { ...ORIGIN_HEADERS, ...(cookie ? { cookie } : {}), ...options.headers },
  });
}

/** The raw `Set-Cookie` header line for `name`, or undefined if the response does not set it. */
export function setCookieLine(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));
}

/** The value of a Set-Cookie line, without attributes. */
export function setCookieValue(line: string): string {
  return line.slice(line.indexOf('=') + 1, line.includes(';') ? line.indexOf(';') : undefined);
}

/** Attribute names (lower-cased, without values) present on a Set-Cookie line. */
export function cookieAttributes(line: string): string[] {
  return line
    .split(';')
    .slice(1)
    .map((part) => part.trim().split('=')[0].toLowerCase());
}

export function attributeValue(line: string, attribute: string): string | undefined {
  const part = line
    .split(';')
    .slice(1)
    .map((p) => p.trim())
    .find((p) => p.toLowerCase().startsWith(`${attribute.toLowerCase()}=`));
  return part?.slice(part.indexOf('=') + 1);
}
