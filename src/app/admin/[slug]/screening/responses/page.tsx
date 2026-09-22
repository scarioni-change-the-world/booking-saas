import { redirect } from 'next/navigation';

/**
 * Responses moved out of the question builder and into their own section.
 *
 * Kept as a redirect rather than deleted: this path is in the address bar of
 * anybody who bookmarked it, and in the "show=" links Overview's figures
 * still point at — which carry their filter through untouched.
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
  redirect(`/admin/${slug}/enquiries${show ? `?show=${encodeURIComponent(show)}` : ''}`);
}
