import type { Metadata } from 'next';
import ManageBooking from '@/components/ManageBooking';

/**
 * Self-service management (brief 2.4).
 *
 * The token in the URL is the credential, so this page must never be indexed
 * and must never appear in a referrer.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function ManagePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ManageBooking token={token} />;
}
