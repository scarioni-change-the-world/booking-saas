'use client';

import { useParams } from 'next/navigation';
import StepTabs from '@/components/admin/StepTabs';
import { PageHeader } from '@/components/ui';

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
      {/* "How a stranger becomes a meeting" was a good line in the wrong
          room. A landing page gets to make an argument; a screen someone
          opens on a Tuesday to add a question should say what it is. The
          brief rules out marketing headlines inside routine workflows, and
          the eyebrow now matches the sidebar, which says Enquiries. */}
      <PageHeader
        eyebrow="Enquiries"
        title="What people answer before booking"
        description="Write the questions, decide where each answer leads, and read what came back."
      />
      <StepTabs base={`/admin/${slug}/screening`} tabs={TABS} />
      {children}
    </>
  );
}
