import type { Metadata } from 'next';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import './globals.css';

/**
 * IBM Plex Sans for UI and body copy, per the brand guide's §7 exactly.
 *
 * Served with the app from @fontsource (OFL), not fetched from Google at
 * build time. next/font/google broke on Vercel's builds: its Turbopack font
 * loader failed with "next/font/google queries have exactly one entry" once
 * Vercel began applying its own config, with nothing in this project
 * changed. The files now ship with the app, so the build needs no network
 * and a visitor's browser never asks Google for anything. Each weight's CSS
 * declares every subset with a unicode-range, so a browser downloads only
 * the scripts a page actually uses.
 *
 * The display family is Arial / Arial Black (wordmark and headline system —
 * see --font-heading and --font-wordmark in globals.css), per the brand
 * guide's Implementation note: "use the system Arial family rather than
 * embedding or redistributing font files." That's why there's no font
 * import for it here the way there is for IBM Plex Sans above — Arial ships
 * with the OS, so the CSS variable just names the system font stack
 * directly rather than pulling in a webfont. An earlier version of this
 * project ran Plus Jakarta Sans as a temporary stand-in for a then-unnamed
 * display face; the brand guide now specifies Arial as the real answer, not
 * a placeholder, so that stand-in is gone.
 */
export const metadata: Metadata = {
  title: 'intro',
  description:
    'The right meeting starts with alignment — a pre-meeting alignment layer for professionals whose work begins with a real conversation.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
