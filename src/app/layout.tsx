import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Booking',
  description: 'Qualify prospects before they reach your calendar.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
