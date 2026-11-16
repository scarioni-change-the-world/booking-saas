import { redirect } from 'next/navigation';

/**
 * The step-by-step setup was retired: a new account lands on Services with
 * "Add your first service" open (set it up, describe it to khloe, or read
 * it from the website). Old links and bookmarks land there too.
 */
export default async function StartPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/admin/${slug}/flow`);
}
