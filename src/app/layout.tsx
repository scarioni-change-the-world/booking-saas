import type { Metadata } from 'next';
import { IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

/**
 * IBM Plex Sans for UI and body copy, per the brand guide's §7 exactly.
 *
 * The display family is Arial / Arial Black (wordmark and headline system —
 * see --font-heading and --font-wordmark in globals.css), per the brand
 * guide's Implementation note: "use the system Arial family rather than
 * embedding or redistributing font files." That's why there's no next/font
 * entry for it here the way there is for IBM Plex Sans below — Arial ships
 * with the OS, so the CSS variable just names the system font stack
 * directly rather than pulling in a webfont. An earlier version of this
 * project ran Plus Jakarta Sans as a temporary stand-in for a then-unnamed
 * display face; the brand guide now specifies Arial as the real answer, not
 * a placeholder, so that stand-in is gone.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'intro',
  description:
    'The right meeting starts with alignment — a pre-meeting alignment layer for professionals whose work begins with a real conversation.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={plexSans.variable}>
      <body>{children}</body>
    </html>
  );
}
