import { redirect } from 'next/navigation';

/**
 * The next-steps message moved to Messages, where it sits at its moment in
 * the client's journey beside the emails. Kept as a redirect so bookmarks
 * and old setup links still land on it.
 */
export default async function NextStepsMoved({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/admin/${slug}/messages?m=next_steps`);
}
