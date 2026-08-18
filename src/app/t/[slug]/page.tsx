import BookingFlow from '@/components/BookingFlow';

/**
 * The prospect door (brief 2.1).
 *
 * Embedded as an iframe on the tenant's public marketing page. Every visitor
 * passes the qualification gate before any calendar is rendered.
 */
export default async function ProspectBookingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <BookingFlow slug={slug} audience="prospect" />;
}
