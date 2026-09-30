/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import { GuestFlowShell } from '@/components/guest/chrome/GuestFlowShell';
import { RegistrationForm } from '@/components/guest/RegistrationForm';
import { GUEST_FLOW_STEPS } from '@/components/guest/flow-steps';
import { Link } from '@/i18n/navigation';
import { findElement } from '@/test/element-tree';

/**
 * KAN-55 — the registration page's own wiring: which step it lights, what it
 * hands the form, and where its sign-in link goes. The preview page has a
 * deliberate test of exactly this shape ("not 'write', which it would silently
 * be if this were copy-pasted"); a `currentStepId="preview"` copied into this
 * page would otherwise ship green. The translator is stubbed to echo the key,
 * so what is asserted is the wiring, not the wording (the catalogue has its own
 * tests and the e2e spec reads the real strings).
 */
vi.mock('next-intl/server', () => ({
  setRequestLocale: () => {},
  getTranslations: async () => (key: string) => key,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/register',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

import RegisterPage from './page';

const ESSAY_ID = 'a6afa382-8223-4b5d-b4ea-d5a7f0694211';

function render(essay?: string | string[]) {
  return RegisterPage({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ essay }) });
}

describe('register page — what it hands the shell', () => {
  it('lights the "register" step of the canonical guest flow — not "preview" or "write", which it would silently be if copy-pasted', async () => {
    const shell = findElement(await render(ESSAY_ID), GuestFlowShell);

    expect(shell?.props.currentStepId).toBe('register');
    expect(shell?.props.steps).toBe(GUEST_FLOW_STEPS);
  });

  it('"back" returns to the report when it came from one, and to the practice landing page otherwise', async () => {
    expect(findElement(await render(ESSAY_ID), GuestFlowShell)?.props.backHref).toBe(`/practice/preview?essay=${ESSAY_ID}`);
    expect(findElement(await render(undefined), GuestFlowShell)?.props.backHref).toBe('/practice');
  });
});

describe('register page — ?essay= is a UUID or nothing', () => {
  it('hands a well-formed id to the form', async () => {
    expect(findElement(await render(ESSAY_ID), RegistrationForm)?.props.essayId).toBe(ESSAY_ID);
  });

  it.each([
    ['absent', undefined],
    ['not a uuid', 'not-a-uuid'],
    ['a path', '/evil'],
    ['an absolute URL', 'https://evil.example/'],
    ['a uuid with a path behind it', `${ESSAY_ID}/../../evil`],
    ['repeated (arrives as an array)', [ESSAY_ID, ESSAY_ID]],
  ] as const)('%s: the form gets no essay, and neither the back link nor the sign-in link carries anything', async (_label, value) => {
    const page = await render(value as string | string[] | undefined);

    expect(findElement(page, RegistrationForm)?.props.essayId).toBeUndefined();
    expect(findElement(page, GuestFlowShell)?.props.backHref).toBe('/practice');
    expect(findElement(page, Link)?.props.href).toBe('/sign-in');
  });
});

describe('register page — the way forward for someone who already has an account', () => {
  it('links to sign-in, carrying the essay so they land back on their report', async () => {
    const link = findElement(await render(ESSAY_ID), Link);

    expect(link?.props.href).toEqual({ pathname: '/sign-in', query: { essay: ESSAY_ID } });
    expect(link?.props.children).toBe('signInLink');
  });

  it('links to sign-in with no essay when there is none', async () => {
    expect(findElement(await render(undefined), Link)?.props.href).toBe('/sign-in');
  });
});
