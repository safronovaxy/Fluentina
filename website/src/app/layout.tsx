import type { Metadata } from 'next';
import Script from 'next/script';
import Providers from '@/components/Providers';
import './globals.css';

const GA4_ID = 'G-VSCF3D4V1F';

export const metadata: Metadata = {
  metadataBase: new URL('https://fluentina.com'),
  title: {
    default: 'Fluentina — Learn German Effectively',
    template: '%s | Fluentina',
  },
  description:
    'Fluentina is an AI-powered German language learning platform that helps you master writing, grammar and vocabulary at your own pace.',
  openGraph: {
    siteName: 'Fluentina',
    type: 'website',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
  twitter: {
    // No `site` handle: @Fluentina is not an account we control, and naming it
    // here puts someone else's profile on every shared link. The card itself
    // still renders from the OpenGraph tags.
    card: 'summary_large_image',
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48', type: 'image/x-icon' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: { url: '/favicon.svg', type: 'image/svg+xml' },
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* 1. Consent Mode v2 defaults — deny all until user chooses; must run before GA4 */}
        <Script id="consent-defaults" strategy="beforeInteractive">
          {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{'ad_storage':'denied','analytics_storage':'denied','ad_user_data':'denied','ad_personalization':'denied','wait_for_update':500});`}
        </Script>

        {/* 2. CookieYes — shows banner, fires gtag('consent','update',...) on user action */}
        <Script
          id="cookieyes"
          src="https://cdn-cookieyes.com/client_data/6ed95aba6362ac13e63e3aae20e0fef6/script.js"
          strategy="beforeInteractive"
        />

        {/* 3. GA4 — loads lazily, respects consent state set above */}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`}
          strategy="lazyOnload"
        />
        <Script id="ga4-init" strategy="lazyOnload">
          {`gtag('js',new Date());gtag('config','${GA4_ID}');`}
        </Script>

        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
