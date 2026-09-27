import PaidReturn from '@/components/booking/PaidReturn';

/**
 * Where Stripe sends a client once they have paid. The booking is made from
 * here or from Stripe's webhook, whichever arrives first.
 */
export default async function PaidPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { slug } = await params;
  const { session_id: sessionId } = await searchParams;
  return <PaidReturn slug={slug} sessionId={sessionId ?? null} />;
}
