import type { Metadata } from 'next';
import ClientBooking from '@/components/ClientBooking';

/**
 * A client's own private link — the whole existing-client surface, now
 * (redeem sessions from a package they've already paid for, or book a
 * one-off session outright). The token resolves to a real clients row,
 * which is what makes tracking a real session balance possible, and what
 * replaced the plain, token-less /t/[slug]/client door — unlisted was never
 * the same thing as authenticated. See migration 0010 and
 * src/lib/booking-service.ts.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ClientBookingPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  return <ClientBooking slug={slug} token={token} />;
}
