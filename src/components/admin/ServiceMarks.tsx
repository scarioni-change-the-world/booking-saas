'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { adminFetchJson } from '@/lib/admin-fetch';
import { monogram, uniqueMonograms } from '@/lib/service-identity';

const MarksContext = createContext<Map<string, string>>(new Map());

/**
 * Every service's two letters, unique across the business, for every
 * screen under it. Read once from the services list and again on each
 * move between screens, so a service added or renamed on one screen has
 * its mark on the next. Until they arrive, a service shows its usual mark.
 */
export function ServiceMarksProvider({ slug, children }: { slug: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [marks, setMarks] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    adminFetchJson<{ eventTypes: Array<{ name: string; createdAt?: string | null }> }>(`/api/admin/${slug}/event-types`)
      .then((r) => {
        if (!cancelled) setMarks(uniqueMonograms(r.eventTypes));
      })
      .catch(() => {
        /* The usual marks stand in; nothing here is worth an error. */
      });
    return () => {
      cancelled = true;
    };
  }, [slug, pathname]);

  return <MarksContext.Provider value={marks}>{children}</MarksContext.Provider>;
}

/** The mark a service goes by on every screen: `mark(name)`. */
export function useServiceMark(): (name: string) => string {
  const marks = useContext(MarksContext);
  return (name) => marks.get(name) ?? monogram(name);
}
