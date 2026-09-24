import { redirect } from 'next/navigation';

/**
 * Overview became the Flow home screen: its figures sit on the lines they
 * count, and what is coming up is on Booked.
 *
 * Kept as a redirect so bookmarks and old links still land.
 */
export default async function Moved({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/admin/${slug}/flow`);
}
