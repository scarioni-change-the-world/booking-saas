import { redirect } from 'next/navigation';

/**
 * The Enquiries analysis moved onto the parts it measures: which questions
 * turn people away is on Questions, how each service converts is on its
 * lane. The list of who answered is in People.
 *
 * Kept as a redirect so bookmarks and old links still land.
 */
export default async function Moved({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/admin/${slug}/flow?part=questions`);
}
