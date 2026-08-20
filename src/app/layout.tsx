import type { Metadata } from 'next';
import { IBM_Plex_Sans, Newsreader } from 'next/font/google';
import './globals.css';

/**
 * Newsreader for headings, IBM Plex Sans for everything else — the Cerca
 * type pairing. Self-hosted via next/font rather than a runtime stylesheet
 * link: no request to Google at page load, no flash of fallback type.
 *
 * The wordmark itself (Cormorant Garamond) is deliberately not loaded here.
 * The customer-facing widget carries almost none of Cerca's own branding —
 * "Powered by Cerca" in the ordinary body font is the full extent of it — so
 * the display logotype face has no page to appear on yet. It belongs with
 * the admin dashboard and marketing chrome, when those exist.
 */
const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-serif',
  display: 'swap',
});

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Cerca',
  // Plain and factual on purpose — the positioning line is not settled yet
  // (see the brand sheet), and this is not the place to pick one unasked.
  description: 'A booking questionnaire that screens prospects before they reach your calendar.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${newsreader.variable} ${plexSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
