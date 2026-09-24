import { redirect } from 'next/navigation';

/**
 * Settings became Account, and most of what it held moved to where it takes
 * effect: notice, booking window and Google Calendar to the Week; the embed
 * code to Flow's "Your page"; email addresses to Messages. Kept as a
 * redirect so bookmarks and old links still land.
 */
export default async function SettingsMoved({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/admin/${slug}/account`);
}
