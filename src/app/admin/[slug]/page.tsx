import { redirect } from 'next/navigation';

/**
 * /admin/[slug] has nothing of its own to show yet — Overview is still a
 * stub (see overview/page.tsx) — so land on the one screen that is real.
 */
export default async function AdminIndexPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/admin/${slug}/sessions`);
}
