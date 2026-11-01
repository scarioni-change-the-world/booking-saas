import type { Metadata } from 'next';
import { OPERATOR, WEBSITE } from '@/lib/operator';

/**
 * Terms of service: the agreement between khloe and a business that uses
 * it. People who book through a business are not party to it; their side
 * is the privacy policy and whatever the business itself tells them.
 *
 * Written to match what the code does (the 7-day trial, €7 + VAT a month
 * through Stripe, the lock rather than deletion when a plan ends, client
 * payments on the business's own Stripe account with no cut taken). Not
 * legal advice: someone qualified should read it, particularly the
 * liability and governing-law sections.
 */
const LAST_UPDATED = '1 November 2026';

export const metadata: Metadata = {
  title: 'Terms of service — khloe',
  description: 'The agreement between khloe and the businesses that use it.',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="legal-plate">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="legal">
      <header className="legal-top">
        <div className="legal-shell legal-top-row">
          <a className="legal-wordmark" href={WEBSITE}>
            khloe
          </a>
          <a className="legal-key" href="/">
            Sign in
          </a>
        </div>
      </header>

      <main className="legal-shell legal-main">
        <p className="legal-eyebrow">Terms</p>
        <h1>Terms of service</h1>
        <p className="legal-lede">
          The agreement between khloe and the businesses that use it, in plain words. Last updated {LAST_UPDATED}.
        </p>

        <Section title="Who this agreement is between">
          <p>
            khloe is operated by {OPERATOR.legalName}, {OPERATOR.address}, {OPERATOR.jurisdiction} (“khloe”,
            “we”). These terms apply to anyone who creates a khloe account for a business, and to everyone on that
            business’s team (“you”). By creating an account you accept them.
          </p>
          <p>
            khloe is a tool for businesses and professionals. You use it for your work, not as a consumer. People who
            book an appointment through your booking page are your clients, not ours: these terms do not apply to
            them, and how we handle their data is set out in our <a href="/privacy">privacy policy</a>.
          </p>
        </Section>

        <Section title="What khloe does">
          <p>
            khloe gives your business a booking page, the questions you ask before someone books, a calendar of
            your sessions, emails to your clients, optional payment when booking, reports, and an optional AI
            assistant. We may improve, change or retire features over time. If we remove something you rely on,
            we will tell you in advance where we reasonably can.
          </p>
        </Section>

        <Section title="Your account">
          <ul>
            <li>Give accurate details, and keep your sign-in private. You are responsible for what happens under your account.</li>
            <li>Whoever creates the account confirms they may act for the business.</li>
            <li>Tell us straight away at {OPERATOR.contactEmail} if you think someone else has got into your account.</li>
          </ul>
        </Section>

        <Section title="Trial, price and payment">
          <ul>
            <li>
              Every new account starts with <strong>7 days free</strong>. Nothing is charged during the trial, and
              no card is needed to start it.
            </li>
            <li>
              After that, khloe costs <strong>€7 a month plus VAT</strong>, paid in advance through Stripe. The
              subscription renews each month until you cancel it.
            </li>
            <li>
              You can cancel at any time from Account → Manage billing. Cancelling stops the next renewal; you keep
              access until the end of the month you have paid for. Months already paid are not refunded, except
              where the law requires it.
            </li>
            <li>
              If we change the price, we will tell you at least 30 days before it applies to you, and you can cancel
              before then.
            </li>
            <li>
              If a payment fails and Stripe cannot collect it, or your trial ends without a subscription, your
              account is locked until you subscribe. Locking deletes nothing.
            </li>
          </ul>
        </Section>

        <Section title="Payments from your clients">
          <p>
            If you ask clients to pay when they book, the payment is taken on <strong>your own Stripe account</strong>,
            under Stripe’s terms, which you accept with Stripe when you connect it. The sale is between you and your
            client. khloe takes no commission on it. You are responsible for your prices, your refunds and
            cancellation rules, any taxes on what you sell, and what you promise your clients.
          </p>
        </Section>

        <Section title="Your content and your clients’ data">
          <p>
            What you put into khloe stays yours: your services, questions, messages and logo, and the bookings and
            details of your clients. You give us permission to store and process it only to run khloe for you.
          </p>
          <p>
            For your clients’ personal data, you are the controller and khloe is your processor: we handle it only on
            your instructions, to provide the service, as described in the <a href="/privacy">privacy policy</a>.
            You are responsible for having a lawful basis to collect what you ask your clients, and for telling them
            how you use it. We keep their data confidential, protect it with appropriate security, use only the
            suppliers listed in the privacy policy, help you answer their requests, and tell you without undue delay
            if we become aware of a breach that affects it.
          </p>
          <p>
            You can ask us to delete your account and everything in it at any time by writing to{' '}
            {OPERATOR.contactEmail}.
          </p>
        </Section>

        <Section title="Fair use">
          <p>You agree not to use khloe to:</p>
          <ul>
            <li>break the law, or offer services that are illegal where you or your clients are;</li>
            <li>send spam or marketing that people have not agreed to;</li>
            <li>collect data you have no right to, such as health details without a lawful basis;</li>
            <li>attack, overload, probe or copy the service, or get around its limits;</li>
            <li>pretend to be someone else, or mislead the people booking with you.</li>
          </ul>
          <p>
            We may suspend an account that does any of these, or that puts other users or the service at risk. Where
            we can, we will tell you first and give you a chance to put it right.
          </p>
        </Section>

        <Section title="The AI assistant">
          <p>
            The AI assistant drafts questions and report summaries when you ask it to. What it writes can be wrong or
            incomplete: read it before you rely on it. It is limited each month (for example, 10 report summaries),
            and the limits may change.
          </p>
        </Section>

        <Section title="Other services we connect to">
          <p>
            khloe works with Google Calendar, Stripe and email providers. When you connect one, its own terms apply
            too. We are not responsible for those services being unavailable or changing how they work, though we
            will do what we reasonably can to keep khloe working with them.
          </p>
        </Section>

        <Section title="Availability">
          <p>
            We work to keep khloe running and your data safe, but we cannot promise it will never be interrupted or
            free of errors. We may need short pauses for maintenance, and we will keep them as short and as rare as
            we can.
          </p>
        </Section>

        <Section title="Liability">
          <p>
            Nothing in these terms limits liability that cannot be limited by law, such as for fraud, wilful
            misconduct or gross negligence.
          </p>
          <p>
            Otherwise, we are not liable for indirect or consequential loss, such as lost profits, lost bookings or
            lost business, and our total liability to you for anything arising from khloe in any 12 months is limited
            to what you paid us in those 12 months.
          </p>
        </Section>

        <Section title="Ending this agreement">
          <p>
            You can stop using khloe and cancel your subscription whenever you like. We can end this agreement with
            30 days’ notice by email, or at once if you seriously break these terms. If we end it without a breach on
            your part, we will refund any part of a month you have paid for and not used.
          </p>
          <p>
            When an account ends, your data stays locked, not deleted, until you ask us to delete it, so you can come
            back or ask for a copy.
          </p>
        </Section>

        <Section title="Changes to these terms">
          <p>
            If we change these terms in a way that matters, we will email the account owner at least 30 days before
            the change applies. If you do not agree, you can cancel before then. Using khloe after that date means you
            accept the new terms.
          </p>
        </Section>

        <Section title="Law and disputes">
          <p>
            These terms are governed by the law of {OPERATOR.jurisdiction}. Any dispute goes to the courts of Palma
            de Mallorca, unless the law gives you the right to go to the courts where you are. Before going to court,
            write to us at {OPERATOR.contactEmail}: most things are quicker to sort out by talking.
          </p>
        </Section>
      </main>

      <footer className="legal-footer">
        <div className="legal-shell legal-footer-row">
          <a href={WEBSITE}>← Back to khloe</a>
          <a href="/privacy">Privacy policy</a>
          <span>Questions: {OPERATOR.contactEmail}</span>
        </div>
      </footer>
    </div>
  );
}
