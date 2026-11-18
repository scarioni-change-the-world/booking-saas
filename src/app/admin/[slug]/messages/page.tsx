'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { MessagesBoard } from '@/components/admin/MessagesBoard';

/** Every message the business sends, for all its services at once. */
export default function MessagesPage() {
  const { slug } = useParams<{ slug: string }>();
  const search = useSearchParams();
  return (
    <>
      <PageHeader
        title="What people are told, and when"
        description="Every email is ready and goes out on its own. Choose a moment to read or change what people are told."
      />
      <MessagesBoard slug={slug} initial={search.get('m')} />
    </>
  );
}
