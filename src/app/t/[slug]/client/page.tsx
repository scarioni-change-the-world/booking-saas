import type { Metadata } from 'next';
import BookingFlow from '@/components/BookingFlow';

/**
 * The existing-client door (brief 2.1, 2.3).
 *
 * A private, unlisted URL the tenant shares with people who have already paid.
 * Straight to the calendar — the questionnaire is never shown, and the event
 * types offered are only those flagged available_to_existing_clients.
 *
 * No welcome copy here on purpose: the host site provides that around the
 * iframe.
 *
 * Unlisted is not the same as authenticated. Anyone holding the URL can book,
 * which matches the reference implementation, but it means client-only session
 * types are protected by obscurity alone. Milestone 2 should replace this with
 * a per-client token, in the same shape as the manage token.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ClientBookingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <BookingFlow slug={slug} audience="client" />;
}
