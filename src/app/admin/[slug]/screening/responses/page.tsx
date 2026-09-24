import { redirect } from 'next/navigation';

/**
 * Responses moved out of the question builder, then into People, where
 * each person's answers sit beside what they went on to do.
 *
 * Kept as a redirect rather than deleted: this path is in the address bar of
 * anybody who bookmarked it. Its old "show=" filters are carried through;
 * People reads them as the nearest of its own.
 */
export default async function ResponsesMoved({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const { slug } = await params;
  const { show } = await searchParams;
  redirect(`/admin/${slug}/people${show ? `?show=${encodeURIComponent(show)}` : ''}`);
}
