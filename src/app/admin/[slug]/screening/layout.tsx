'use client';

import { PageHeader } from '@/components/ui';

/**
 * One step now: write the questions, and say on each answer where it leads.
 *
 * Reading what came back moved to its own section long ago (Enquiries, and
 * now People). What people are told when an answer sends them elsewhere
 * moved to Messages, beside every other thing they are told, so this is
 * no longer a set of tabs.
 */
export default function ScreeningLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader
        eyebrow="Questions"
        title="What people answer before booking"
        description="Write the questions, and decide where each answer leads. What people are told is under Messages; what came back is under People."
      />
      {children}
    </>
  );
}
