'use client';

import { useParams } from 'next/navigation';
import StepTabs from '@/components/admin/StepTabs';

const TABS = [
  { href: '', label: 'Questions' },
  { href: 'next-steps', label: 'Next steps' },
  { href: 'responses', label: 'Responses' },
];

/**
 * Intake is a three-step builder — write the questions, decide what each
 * answer does, see who answered — not three unrelated pages, so it gets a
 * shared tab bar instead of three sidebar entries. The sidebar's "Intake"
 * link still points at the first step (screening/page.tsx); this layout
 * wraps that page and its next-steps/responses siblings.
 */
export default function ScreeningLayout({ children }: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>();

  return (
    <>
      <div className="admin-page-head" style={{ marginBottom: 14 }}>
        <div>
          <div className="admin-eyebrow">Intake</div>
          <h1>How a stranger becomes a meeting</h1>
        </div>
      </div>
      <StepTabs base={`/admin/${slug}/screening`} tabs={TABS} />
      {children}
    </>
  );
}
