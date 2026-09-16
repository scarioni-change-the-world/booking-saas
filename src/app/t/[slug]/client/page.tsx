import type { Metadata } from 'next';
import ClientLinkRequest from '@/components/ClientLinkRequest';

/**
 * "Send me my booking link again."
 *
 * This path used to be the existing-client door itself — unlisted, and
 * therefore not actually authenticated, which is why it was retired in
 * favour of a per-client token. Reusing the path rather than leaving it a
 * 404 means an old bookmark now lands on the one thing that can still help
 * whoever followed it: a way to get their real link.
 *
 * Nothing here is privileged. The form reveals nothing about who is or
 * isn't a client (see /api/t/[slug]/client-link), and the link itself only
 * ever arrives by email, at an address the business already had on file.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ClientLinkPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ClientLinkRequest slug={slug} />;
}
