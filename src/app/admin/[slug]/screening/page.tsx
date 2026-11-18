'use client';

import { useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { adminFetchJson } from '@/lib/admin-fetch';

/**
 * The Questions page is gone: a service's questions, shared ones included,
 * are edited on that service's own Questions tab, with where each answer
 * leads and what people sent elsewhere are told. Two places to write the
 * same questions was a detour in every flow that needed them.
 *
 * Old links still land somewhere useful: on the named service's Questions
 * tab, or the first service's (shared questions are the same list on
 * every service), or Services when there is none yet.
 */
export default function QuestionsMoved() {
  const { slug } = useParams<{ slug: string }>();
  const search = useSearchParams();

  useEffect(() => {
    const go = (path: string) => window.location.replace(`/admin/${slug}/${path}`);
    const named = search.get('service');
    if (named) return go(`sessions/${encodeURIComponent(named)}?tab=questions`);
    adminFetchJson<{ eventTypes: Array<{ id: string; active: boolean }> }>(`/api/admin/${slug}/event-types`)
      .then((r) => {
        const first = r.eventTypes.find((t) => t.active) ?? r.eventTypes[0];
        go(first ? `sessions/${first.id}?tab=questions` : 'flow');
      })
      .catch(() => go('flow'));
  }, [slug, search]);

  return <p className="status">Opening your questions…</p>;
}
