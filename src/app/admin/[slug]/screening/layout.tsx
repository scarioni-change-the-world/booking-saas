'use client';

import { useParams } from 'next/navigation';
import StepTabs from '@/components/admin/StepTabs';
import { PageHeader } from '@/components/ui';

const TABS = [
  { href: '', label: 'Questions' },
  { href: 'next-steps', label: 'Next steps' },
];

/**
 * Two steps, not three: write the questions, decide what each answer does.
 *
 * Reading what came back used to be the third tab here, which quietly said
 * that a month of evidence was the last thing you configure. It has its own
 * section now (admin/[slug]/enquiries) — different rhythm, different place.
 * A builder is something you finish; analysis is something you return to.
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
        eyebrow="Questions"
        title="What people answer before booking"
        description="Write the questions, and decide where each answer leads. What came back is under Enquiries."
      />
      <StepTabs base={`/admin/${slug}/screening`} tabs={TABS} />
      {children}
    </>
  );
}
