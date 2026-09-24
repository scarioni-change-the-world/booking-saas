import { redirect } from 'next/navigation';

/** Home is the Flow: how people reach you, drawn as it is. */
export default async function AdminIndexPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/admin/${slug}/flow`);
}
