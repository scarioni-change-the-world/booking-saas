import BookingFlow from '@/components/BookingFlow';

/**
 * The prospect door (brief 2.1).
 *
 * Served two ways from this one route: as a link the business shares, and
 * inside an iframe on their own website (see src/lib/embed.ts for the
 * per-tenant frame-ancestors that allows the second). Either way every
 * visitor passes the qualification gate before any calendar is rendered.
 */
export default async function ProspectBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { slug } = await params;
  // ?mode=embedded forces the embedded shell for a customer who frames this
  // somewhere the frame check cannot see — a modal on their own site, say.
  // Anything else falls through to the component's own detection.
  const { mode } = await searchParams;
  return <BookingFlow slug={slug} mode={mode === 'embedded' ? 'embedded' : undefined} />;
}
