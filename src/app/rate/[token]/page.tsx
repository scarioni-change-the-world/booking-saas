import RateSession from '@/components/booking/RateSession';

/** Where the "How was it?" email lands. */
export default async function RatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <RateSession token={token} />;
}
