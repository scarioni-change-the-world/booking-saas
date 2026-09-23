import { redirect } from 'next/navigation';

/**
 * Availability is now part of the Week: usual hours are painted on it, and
 * a date's own hours and blocked time open from its column.
 */
export default async function AvailabilityRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/admin/${slug}/week`);
}
