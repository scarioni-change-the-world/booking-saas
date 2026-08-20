import type { Metadata } from 'next';
import { Cormorant_Garamond, IBM_Plex_Sans, Newsreader } from 'next/font/google';
import './globals.css';

/**
 * Newsreader for headings, IBM Plex Sans for everything else — the Cerca
 * type pairing. Self-hosted via next/font rather than a runtime stylesheet
 * link: no request to Google at page load, no flash of fallback type.
 *
 * Cormorant Garamond is the wordmark face — "Cerca" itself, nowhere else.
 * It stayed unloaded until now because it had nowhere to appear: the
 * customer widget carries almost none of Cerca's own identity, just
 * "Powered by Cerca" in the ordinary body font. The admin dashboard's own
 * sidebar is the first real page that shows the wordmark.
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

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-cormorant',
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
    <html
      lang="en"
      className={`${newsreader.variable} ${plexSans.variable} ${cormorant.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
