import { redirect } from 'next/navigation';

/**
 * Bookings is now part of the Week. An old link lands on the Week's list
 * view, which is the same list this page used to be.
 */
export default async function BookingsRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/admin/${slug}/week?view=list`);
}
