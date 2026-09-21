/**
 * The shell the three sign-in screens share.
 *
 * Sign in, ask for a reset link, and set a new password are one journey a
 * person can move through in a single sitting, sometimes twice. Three
 * separate hand-built copies of this markup would drift — and the drift
 * would land exactly where it is most alarming, on the screens where
 * somebody is already worried about whether they still have an account.
 *
 * The scene is the marketing site's own closing image under its own closing
 * line; see .signin-split in globals.css for why the form comes first in the
 * DOM and the picture is placed back into column one by grid.
 */

/**
 * Where "Back to the Intro website" goes.
 *
 * Read from the environment rather than hard-coded, because the marketing
 * site has no final domain yet — the product name is still being decided.
 * When it is unset the link is not rendered at all. A dead link back to the
 * website would undo exactly the continuity this page exists to create.
 * Note that / on this app is the OAuth verification homepage, not the
 * marketing site, so it is not a usable fallback.
 */
const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL;

export const SUPPORT_EMAIL = 'hello.intro.booking@gmail.com';

export function SignInLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="signin-split">
      <main className="signin-panel">
        <div className="signin-column">
          {/* A span, not an h1: each page's own heading says what it is for.
              The wordmark says whose door this is, which is a different job. */}
          <span className="signin-wordmark">intro</span>

          {children}

          <div className="signin-foot">
            {MARKETING_URL && (
              <p>
                <a href={MARKETING_URL}>Back to the Intro website</a>
              </p>
            )}
            <p>
              Need help accessing your account? Contact{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </p>
          </div>
        </div>
      </main>

      {/* Second in the DOM, first on screen — see .signin-split. The picture
          is decorative and hidden from assistive tech; the line over it is
          not, so it stays readable. */}
      <aside className="signin-scene">
        <img
          className="signin-scene__image"
          src="/images/two-chair-lounge.webp"
          alt=""
          width={1448}
          height={1086}
          aria-hidden="true"
        />
        <div className="signin-scene__shade" aria-hidden="true" />
        <div className="signin-scene__words">
          <p className="signin-scene__line">Manage the booking. Improve the meeting.</p>
          <p className="signin-scene__sub">
            Your services, availability and client context in one place.
          </p>
        </div>
      </aside>
    </div>
  );
}
