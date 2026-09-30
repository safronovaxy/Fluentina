/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import { GuestFlowShell } from '@/components/guest/chrome/GuestFlowShell';
import { SignInForm } from '@/components/guest/SignInForm';
import { Link } from '@/i18n/navigation';
import { findElement } from '@/test/element-tree';

/**
 * KAN-55 — the sign-in page's own wiring, and the `?essay=` guard that lets it
 * carry a report through sign-in. See register/page.test.tsx for why pages get
 * their own wiring tests and why the translator echoes keys.
 */
vi.mock('next-intl/server', () => ({
  setRequestLocale: () => {},
  getTranslations: async () => (key: string) => key,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/sign-in',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

import SignInPage from './page';

const ESSAY_ID = 'a6afa382-8223-4b5d-b4ea-d5a7f0694211';

function render(essay?: string | string[]) {
  return SignInPage({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ essay }) });
}

describe('sign-in page — what it hands the shell', () => {
  it('is not a step of the guest essay flow: no steps, nothing highlighted', async () => {
    const shell = findElement(await render(undefined), GuestFlowShell);

    expect(shell?.props.steps).toEqual([]);
    expect(shell?.props.currentStepId).toBe('none');
  });

  it('"back" returns to the report when it came from one, and to the practice landing page otherwise', async () => {
    expect(findElement(await render(ESSAY_ID), GuestFlowShell)?.props.backHref).toBe(`/practice/preview?essay=${ESSAY_ID}`);
    expect(findElement(await render(undefined), GuestFlowShell)?.props.backHref).toBe('/practice');
  });
});

describe('sign-in page — ?essay= is a UUID or nothing', () => {
  it('hands a well-formed id to the form', async () => {
    expect(findElement(await render(ESSAY_ID), SignInForm)?.props.essayId).toBe(ESSAY_ID);
  });

  it.each([
    ['absent', undefined],
    ['not a uuid', 'not-a-uuid'],
    ['a path', '/evil'],
    ['an absolute URL', 'https://evil.example/'],
    ['a uuid with a path behind it', `${ESSAY_ID}/../../evil`],
    ['repeated (arrives as an array)', [ESSAY_ID, ESSAY_ID]],
  ] as const)('%s: the form gets no essay, and neither the back link nor the register link carries anything', async (_label, value) => {
    const page = await render(value as string | string[] | undefined);

    expect(findElement(page, SignInForm)?.props.essayId).toBeUndefined();
    expect(findElement(page, GuestFlowShell)?.props.backHref).toBe('/practice');
    expect(findElement(page, Link)?.props.href).toBe('/register');
  });
});

describe('sign-in page — the link to registration', () => {
  it('points at /register, carrying the essay so the round trip does not lose it', async () => {
    const link = findElement(await render(ESSAY_ID), Link);

    expect(link?.props.href).toEqual({ pathname: '/register', query: { essay: ESSAY_ID } });
    expect(link?.props.children).toBe('registerLink');
  });

  it('points at /register with no essay when there is none', async () => {
    expect(findElement(await render(undefined), Link)?.props.href).toBe('/register');
  });
});
