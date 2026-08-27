import type { Metadata } from 'next';
import { IBM_Plex_Sans, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

/**
 * IBM Plex Sans for UI and body copy, per the brand guide's §7 exactly.
 *
 * Plus Jakarta Sans stands in for Mangal Pro Bold — the guide's specified
 * display face for the wordmark, hero headlines and major statements — which
 * is a licensed webfont this project doesn't have and isn't on a public font
 * service. The guide's own implementation note allows exactly this: "a
 * temporary development fallback is acceptable only until the actual brand
 * font is implemented." When a licensed Mangal Pro Bold webfont exists,
 * swap it in here — nothing else in the app needs to change, since every
 * consumer reads the --font-display variable, not this file directly.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

const display = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['700', '800'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'intro',
  description:
    'The right meeting starts with alignment — a pre-meeting alignment layer for professionals whose work begins with a real conversation.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
