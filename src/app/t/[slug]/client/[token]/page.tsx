import type { Metadata } from 'next';
import ClientPackageBooking from '@/components/ClientPackageBooking';

/**
 * A client's own private link — redeem sessions from a package they've
 * already paid for. Unlisted, like the plain /t/[slug]/client door, but this
 * one actually identifies who is booking (the token resolves to a real
 * clients row), which is what makes tracking a real session balance
 * possible. See migration 0010 and src/lib/booking-service.ts.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ClientPackagePage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  return <ClientPackageBooking slug={slug} token={token} />;
}
