/**
 * The public homepage.
 *
 * This page also serves as the OAuth consent-screen homepage, and that is not
 * incidental — brief 6.5 records a verification failure that cost real time.
 * Google's branding review fetches the homepage with a non-Googlebot agent.
 * Squarespace's default robots.txt blocks `GoogleOther` with `Disallow: /`, so
 * the reviewer could not read the page at all, and reported "homepage does not
 * explain the purpose of your app" and "app name does not match" — errors no
 * amount of editing the copy could fix, because the copy was never read.
 *
 * Two rules follow, and both are structural:
 *
 *   1. The OAuth homepage is served from a domain we control — this app — never
 *      from a customer's website builder.
 *   2. It is publicly reachable without login. Pointing it at a dashboard fails
 *      review, because an anonymous reviewer sees only a password form.
 *
 * So: no auth, no redirect, and copy that states plainly what the app does and
 * what it does with calendar data.
 *
 * The privacy-policy link at the bottom is part of that, not decoration:
 * verification requires a policy reachable from the homepage, on this same
 * domain. See src/app/privacy/page.tsx — which still has placeholders to
 * fill in before any of this is submitted.
 */
export default function HomePage() {
  return (
    <main className="widget">
      {/* The name must match the app name on Google's consent screen exactly. */}
      <h1>Khloe</h1>
      <p className="lede">
        Khloe is booking software for coaches, therapists and consultants, with
        a short set of questions in front of the calendar. More at{' '}
        <a href="https://khloe.io">khloe.io</a>.
      </p>

      <div className="card">
        <h2>What this app does</h2>
        <p style={{ margin: 0 }}>
          Service businesses embed a booking page on their website. Prospective
          clients answer a short set of screening questions before any times are
          shown; those who match the business&apos;s criteria go on to pick a
          slot, and the rest are shown an alternative. Existing clients book
          through a separate link with no questionnaire.
        </p>
      </div>

      <div className="card">
        <h2>How this app uses Google Calendar</h2>
        <p style={{ margin: '0 0 10px' }}>
          When a business connects its Google Calendar, this app:
        </p>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            reads free/busy information, so a time that is already committed is
            never offered to a client;
          </li>
          <li>
            creates a calendar event for each booking, with a video-conferencing
            link, and updates or removes it when the client reschedules or
            cancels.
          </li>
        </ul>
        <p style={{ margin: '10px 0 0' }}>
          Calendar data is used only to schedule that business&apos;s own
          bookings in Khloe. It is never sold, never shared with other businesses using
          this app, and never used for advertising or model training. A business
          can disconnect its calendar at any time from its settings, which
          deletes the stored credentials.
        </p>
      </div>

      <p className="tz">
        Run a practice? <a href="/admin/signup">Create an account</a> — 7 days
        free — or <a href="/admin/login">sign in</a>.
      </p>

      <p className="tz">
        Questions about how your data is handled? See the{' '}
        <a href="/privacy">privacy policy</a>, which names the address to
        write to.
      </p>
    </main>
  );
}
