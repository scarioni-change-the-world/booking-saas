import { redirect } from 'next/navigation';

/**
 * The Services list became the lanes of the Flow: each service is drawn with
 * what it is missing, and a new one is added from there.
 *
 * Kept as a redirect so bookmarks and old links still land.
 */
export default async function Moved({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/admin/${slug}/flow`);
}
