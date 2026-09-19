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
  lastUpdated: '19 September 2026',
};

export const metadata: Metadata = {
  title: 'Privacy policy — intro',
  description:
    'What data intro collects, why, who processes it, and how to exercise your rights over it.',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <main className="widget">
      <h1>Privacy policy</h1>
      <p className="lede">
        What intro collects, why it collects it, and who else ever sees it.
        Last updated {OPERATOR.lastUpdated}.
      </p>

      <Section title="Who we are">
        <p style={{ margin: 0 }}>
          intro is operated by {OPERATOR.legalName}, {OPERATOR.address},
          established in {OPERATOR.jurisdiction}. For anything in this policy,
          including a request to see or delete your data, write to{' '}
          <strong>{OPERATOR.contactEmail}</strong>.
        </p>
      </Section>

      <Section title="Two different relationships">
        <p style={{ margin: '0 0 10px' }}>
          This matters for knowing who to ask about what, so it comes first
          rather than buried at the end.
        </p>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li style={{ marginBottom: 8 }}>
            <strong>If you are a business using intro</strong>, we are the
            controller of your account data — your email, your settings, your
            billing status. You deal with us directly.
          </li>
          <li>
            <strong>If you booked an appointment through a business that uses
            intro</strong>, that business is the controller of your booking and
            your questionnaire answers. We only process it on their
            instructions, as their supplier. Ask them first — about what they
            hold, why, or to have it deleted. We will help them answer, and we
            will not use their data for our own purposes.
          </li>
        </ul>
      </Section>

      <Section title="What we collect, and why">
        <p style={{ margin: '0 0 10px' }}>
          <strong>From people making a booking:</strong> your name, email
          address, anything you type into the notes field, your answers to the
          screening questions the business set, and the time you booked. This
          is what makes the appointment exist and lets us email you a
          confirmation you can use to reschedule or cancel.
        </p>
        <p style={{ margin: '0 0 10px' }}>
          <strong>From businesses using intro:</strong> the email address of
          each team member (used to sign in), the business&apos;s name, time
          zone and booking settings, and its client list where it chooses to
          keep one.
        </p>
        <p style={{ margin: 0 }}>
          <strong>Automatically:</strong> your IP address is counted against a
          short-lived rate limit when you submit a booking or start a
          questionnaire, so the page cannot be flooded. It is stored as a
          counter, not attached to your booking, and is deleted within about a
          day. We do not use advertising or analytics cookies, and there is no
          tracking pixel anywhere in this app.
        </p>
      </Section>

      <Section title="Google Calendar data">
        <p style={{ margin: '0 0 10px' }}>
          This section applies only to a business that chooses to connect its
          Google Calendar. Nothing here affects people booking appointments.
        </p>
        <p style={{ margin: '0 0 10px' }}>
          With permission, intro requests three scopes and uses each for one
          thing:
        </p>
        <ul style={{ margin: '0 0 10px', paddingLeft: 20 }}>
          <li style={{ marginBottom: 6 }}>
            <code>calendar.freebusy</code> — to read which times are already
            committed, so a busy slot is never offered to a client. We read
            busy/free periods, not the contents, titles or attendees of
            existing events.
          </li>
          <li style={{ marginBottom: 6 }}>
            <code>calendar.events</code> — to create an event for each booking
            with a video-conferencing link, and to update or delete it when
            the client reschedules or cancels.
          </li>
          <li>
            <code>userinfo.email</code> — to show which Google account is
            connected, so a business can tell whether it connected the right
            one.
          </li>
        </ul>
        <p style={{ margin: '0 0 10px' }}>
          Access and refresh tokens are encrypted before they are stored
          (AES-256-GCM), so a copy of the database is not a set of usable
          calendar credentials. Disconnecting a calendar in settings deletes
          the stored credentials and asks Google to revoke them.
        </p>
        <p style={{ margin: 0 }}>
          intro&apos;s use of information received from Google APIs adheres to
          the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Google user data is used
          only to provide the scheduling features above. It is never sold,
          never shared with other businesses using intro, never used for
          advertising, and never used to train any model — including the
          AI-assisted feature described below.
        </p>
      </Section>

      <Section title="Who else processes this data">
        <p style={{ margin: '0 0 10px' }}>
          We use a small number of suppliers, each for one job:
        </p>
        <ul style={{ margin: '0 0 10px', paddingLeft: 20 }}>
          <li style={{ marginBottom: 6 }}>
            <strong>Supabase</strong> — hosts the database and handles sign-in
            for business accounts.
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong>Vercel</strong> — hosts and serves the application.
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong>Google</strong> — only for businesses that connect a
            calendar, as described above.
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong>Our email provider</strong> — delivers booking
            confirmations, reschedule and cancellation notices. It necessarily
            sees the recipient address and the contents of those emails.
          </li>
          <li>
            <strong>Anthropic</strong> — used only when a business asks for
            help drafting its own screening questions, and it receives only
            what that business typed to describe its own work. No client
            name, email, booking or questionnaire answer is ever sent to it.
          </li>
        </ul>
        <p style={{ margin: 0 }}>
          We do not sell personal data, and we do not share it with anyone
          else for their own purposes.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p style={{ margin: '0 0 10px' }}>
          Bookings, clients and questionnaire answers are kept for as long as
          the business that collected them keeps its account, because that
          business needs its own history. A business can delete individual
          clients and cancel bookings from its dashboard at any time, and can
          ask us to delete its account and everything in it.
        </p>
        <p style={{ margin: 0 }}>
          Rate-limiting counters holding IP addresses are deleted within about
          a day. We are honest that automated export and bulk-deletion tooling
          is still being built: until it ships, these requests are handled by
          writing to the address above, and we will not refuse one because the
          button does not exist yet.
        </p>
      </Section>

      <Section title="Your rights">
        <p style={{ margin: '0 0 10px' }}>
          If you are in the UK or the European Economic Area, you have the
          right to ask for a copy of your data, to have it corrected or
          deleted, to restrict or object to how it is used, and to have it
          sent to another provider. You can exercise any of these by writing
          to {OPERATOR.contactEmail}.
        </p>
        <p style={{ margin: 0 }}>
          If you booked through a business using intro, that business is the
          one to ask — see &ldquo;Two different relationships&rdquo; above. You
          can also complain to the data-protection authority in{' '}
          {OPERATOR.jurisdiction} or in the country where you live.
        </p>
      </Section>

      <Section title="Security">
        <p style={{ margin: 0 }}>
          Data is encrypted in transit. Calendar credentials are additionally
          encrypted at rest. Each business&apos;s data is isolated from every
          other business&apos;s at the database layer, and that isolation is
          enforced structurally rather than left to individual queries to
          remember. Links that let a client manage a booking, or book without
          signing in, are unguessable tokens generated from a cryptographic
          random source — treat one like a password, and tell the business if
          you think yours has been seen by someone else.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p style={{ margin: 0 }}>
          If we change how data is handled in a way that affects you, we will
          update the date at the top of this page, and tell businesses using
          intro directly where the change is material.
        </p>
      </Section>

      <p className="tz" style={{ marginTop: 20 }}>
        <a href="/">← Back to intro</a>
      </p>
    </main>
  );
}
