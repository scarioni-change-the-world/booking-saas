import type { Metadata } from 'next';

/**
 * The privacy policy.
 *
 * Required, not optional: Google's OAuth verification will not pass without
 * a privacy policy that is publicly reachable, on the same domain as the
 * app, and specific about what Google user data is used for. The same two
 * structural rules the homepage records (brief 6.5) apply here — served
 * from a domain we control, readable with no login — because a reviewer
 * who cannot read the page reports it as missing, not as unclear.
 *
 * It is reached from the marketing site's footer, so it wears the marketing
 * site's clothes (.legal in globals.css) rather than the app's: someone who
 * clicked "Privacy" there should not feel they have left. For the same
 * reason the way back goes to the website, not to / on this app, which is
 * the OAuth verification homepage.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  BEFORE PUBLISHING: fill in OPERATOR below. The placeholders render
 *  visibly on the live page on purpose — a policy that goes out with
 *  "[[ LEGAL ENTITY NAME ]]" in it should be impossible to miss, and a
 *  failed Google review costs weeks. This draft is also not legal advice:
 *  it is an accurate description of what the code actually does, which is
 *  the hard half, but someone qualified should read it before it is relied
 *  on — particularly the controller/processor split and the GDPR rights
 *  section, which have consequences beyond this repository.
 * ─────────────────────────────────────────────────────────────────────────
 */
const OPERATOR = {
  legalName: '[[ LEGAL ENTITY NAME ]]',
  address: '[[ REGISTERED ADDRESS ]]',
  contactEmail: '[[ PRIVACY CONTACT EMAIL ]]',
  /** The country whose data-protection authority supervises you, e.g.
   * "Spain" — this is what a reader needs to know where to complain. */
  jurisdiction: '[[ COUNTRY OF ESTABLISHMENT ]]',
  lastUpdated: '29 September 2026',
};

/** The website this page is linked from. Set at build time; without it, / is the best there is. */
const WEBSITE = process.env.NEXT_PUBLIC_MARKETING_URL?.replace(/\/+$/, '') || '/';

export const metadata: Metadata = {
  title: 'Privacy policy — intro',
  description: 'What data intro collects, why, who processes it, and how to exercise your rights over it.',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="legal-plate">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="legal">
      <header className="legal-top">
        <div className="legal-shell legal-top-row">
          <a className="legal-wordmark" href={WEBSITE}>
            intro
          </a>
          <a className="legal-key" href="/admin/login">
            Sign in
          </a>
        </div>
      </header>

      <main className="legal-shell legal-main">
        <p className="legal-eyebrow">Privacy</p>
        <h1>Privacy policy</h1>
        <p className="legal-lede">
          What intro collects, why it collects it, and who else ever sees it. Last updated{' '}
          {OPERATOR.lastUpdated}.
        </p>

        <Section title="Who we are">
          <p>
            intro is operated by {OPERATOR.legalName}, {OPERATOR.address}, established in{' '}
            {OPERATOR.jurisdiction}. For anything in this policy, including a request to see or delete
            your data, write to <strong>{OPERATOR.contactEmail}</strong>.
          </p>
        </Section>

        <Section title="Two different relationships">
          <p>This matters for knowing who to ask about what, so it comes first rather than buried at the end.</p>
          <ul>
            <li>
              <strong>If you are a business using intro</strong>, we are the controller of your account
              data — your email, your settings, your billing status. You deal with us directly.
            </li>
            <li>
              <strong>If you booked an appointment through a business that uses intro</strong>, that
              business is the controller of your booking, your questionnaire answers and any rating you
              leave. We only process it on their instructions, as their supplier. Ask them first — about
              what they hold, why, or to have it deleted. We will help them answer, and we will not use
              their data for our own purposes.
            </li>
          </ul>
        </Section>

        <Section title="What we collect, and why">
          <p>
            <strong>From people making a booking:</strong> your name, email address, anything you type
            into the notes field, your answers to the screening questions the business set, and the time
            you booked. This is what makes the appointment exist and lets us email you a confirmation you
            can use to reschedule or cancel. If you cancel, we keep the reason you give, if any. If the
            business asks for payment when you book, the card payment is taken by Stripe (see below); we
            keep only whether it was paid or refunded, never your card details.
          </p>
          <p>
            <strong>After a session:</strong> the business can mark whether it took place. If it has
            chosen to, we send you one short email afterwards asking how it went; the score from one to
            five and any comment you write go to that business. You can ignore the email — nothing
            follows it up.
          </p>
          <p>
            <strong>From businesses using intro:</strong> the email address of each team member (used to
            sign in), the business&apos;s name, address for its booking page, time zone, opening hours
            and booking settings, and its client list where it chooses to keep one. When a business signs
            up, we email it a link to confirm the address before the account exists. Subscription billing
            is handled by Stripe.
          </p>
          <p>
            <strong>Automatically:</strong> when someone opens a business&apos;s booking page we count the
            visit — a time and a short label for where it came from (for example &ldquo;instagram&rdquo;,
            taken from the link or the referring site). The count holds nothing that identifies the
            visitor: no IP address, no cookie, no device fingerprint. So that a reload is not counted
            twice, your browser remembers the visit for that tab only, and forgets it when the tab
            closes. Your IP address is counted against a short-lived rate limit when you submit a booking
            or start a questionnaire, so the page cannot be flooded. It is stored as a counter, not
            attached to your booking, and is deleted within about a day. We do not use advertising or
            analytics cookies, and there is no tracking pixel anywhere in this app.
          </p>
        </Section>

        <Section title="Google Calendar data">
          <p>
            This section applies only to a business that chooses to connect its Google Calendar. Nothing
            here affects people booking appointments.
          </p>
          <p>With permission, intro requests three scopes and uses each for one thing:</p>
          <ul>
            <li>
              <code>calendar.freebusy</code> — to read which times are already committed, so a busy slot
              is never offered to a client. We read busy/free periods, not the contents, titles or
              attendees of existing events.
            </li>
            <li>
              <code>calendar.events</code> — to create an event for each booking with a
              video-conferencing link, and to update or delete it when the client reschedules or cancels.
            </li>
            <li>
              <code>userinfo.email</code> — to show which Google account is connected, so a business can
              tell whether it connected the right one.
            </li>
          </ul>
          <p>
            Access and refresh tokens are encrypted before they are stored (AES-256-GCM), so a copy of the
            database is not a set of usable calendar credentials. Disconnecting a calendar in settings
            deletes the stored credentials and asks Google to revoke them.
          </p>
          <p>
            intro&apos;s use of information received from Google APIs adheres to the{' '}
            <a href="https://developers.google.com/terms/api-services-user-data-policy">
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements. Google user data is used only to provide the
            scheduling features above. It is never sold, never shared with other businesses using intro,
            never used for advertising, never sent to the AI assistant described below, and never used to
            train any model.
          </p>
        </Section>

        <Section title="Who else processes this data">
          <p>We use a small number of suppliers, each for one job:</p>
          <ul>
            <li>
              <strong>Supabase</strong> — hosts the database and handles sign-in for business accounts.
            </li>
            <li>
              <strong>Vercel</strong> — hosts and serves the application.
            </li>
            <li>
              <strong>Google</strong> — only for businesses that connect a calendar, as described above.
            </li>
            <li>
              <strong>Stripe</strong> — takes subscription payments from businesses, and, for a business
              that asks clients to pay when they book, takes that payment on the business&apos;s own Stripe
              account. Stripe receives the payer&apos;s card details directly; they never pass through
              intro.
            </li>
            <li>
              <strong>Our email provider</strong> — delivers sign-up links, booking confirmations,
              reminders, reschedule and cancellation notices and rating requests. It necessarily sees the
              recipient address and the contents of those emails.
            </li>
            <li>
              <strong>Anthropic</strong> — provides the AI assistant, used only when a business asks for
              it, in two places. When a business asks for help drafting its screening questions, it
              receives only what that business typed to describe its own work. When a business asks for a
              written summary of its Reports, it receives the period&apos;s figures (bookings, hours,
              visits by source, cancellations), the text of the business&apos;s own questions with counts
              of how they were answered, cancellation reasons, and rating comments — without any
              client&apos;s name, email address or booking details attached. Anthropic does not use this
              to train its models.
            </li>
          </ul>
          <p>We do not sell personal data, and we do not share it with anyone else for their own purposes.</p>
        </Section>

        <Section title="How long we keep it">
          <p>
            Bookings, clients, questionnaire answers, ratings and visit counts are kept for as long as the
            business that collected them keeps its account, because that business needs its own history.
            A business can delete individual clients and cancel bookings from its dashboard at any time,
            and can ask us to delete its account and everything in it.
          </p>
          <p>
            Rate-limiting counters holding IP addresses are deleted within about a day. We are honest that automated export and
            bulk-deletion tooling is still being built: until it ships, these requests are handled by
            writing to the address above, and we will not refuse one because the button does not exist
            yet.
          </p>
        </Section>

        <Section title="Your rights">
          <p>
            If you are in the UK or the European Economic Area, you have the right to ask for a copy of
            your data, to have it corrected or deleted, to restrict or object to how it is used, and to
            have it sent to another provider. You can exercise any of these by writing to{' '}
            {OPERATOR.contactEmail}.
          </p>
          <p>
            If you booked through a business using intro, that business is the one to ask — see
            &ldquo;Two different relationships&rdquo; above. You can also complain to the data-protection
            authority in {OPERATOR.jurisdiction} or in the country where you live.
          </p>
        </Section>

        <Section title="Security">
          <p>
            Data is encrypted in transit. Calendar credentials are additionally encrypted at rest. Each
            business&apos;s data is isolated from every other business&apos;s at the database layer, and
            that isolation is enforced structurally rather than left to individual queries to remember.
            Links that let a client manage a booking, rate a session, or book without signing in are
            unguessable tokens generated from a cryptographic random source — treat one like a password,
            and tell the business if you think yours has been seen by someone else.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            If we change how data is handled in a way that affects you, we will update the date at the top
            of this page, and tell businesses using intro directly where the change is material.
          </p>
        </Section>
      </main>

      <footer className="legal-footer">
        <div className="legal-shell legal-footer-row">
          <a href={WEBSITE}>← Back to intro</a>
          <span>Questions about your data: {OPERATOR.contactEmail}</span>
        </div>
      </footer>
    </div>
  );
}
