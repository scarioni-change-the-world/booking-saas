import { redirect } from 'next/navigation';

/**
 * Clients became part of People: one row per person, whether they answered,
 * booked or were added by hand. Kept as a redirect so bookmarks still land.
 */
export default async function ClientsMoved({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/admin/${slug}/people`);
}
