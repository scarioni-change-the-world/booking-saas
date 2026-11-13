/** Where the credit links: the marketing site, set at build time. */
const SITE = process.env.NEXT_PUBLIC_MARKETING_URL?.replace(/\/+$/, '') || 'https://khloe.io';

/**
 * khloe's one line on a client's screen, small, at the foot: "Bookings by
 * khloe". It opens khloe's site in a new tab, so a client inside an embed
 * never loses the business's page.
 */
export function KhloeCredit() {
  return (
    <p className="bk-credit">
      Bookings by{' '}
      <a href={`${SITE}/?ref=booking-page`} target="_blank" rel="noopener" className="bk-wordmark">
        khloe
      </a>
    </p>
  );
}
