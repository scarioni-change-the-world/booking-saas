'use client';

import { useEffect } from 'react';

/**
 * Tell a host page how tall this needs to be.
 *
 * Only when actually framed, and only ever the height — the message carries
 * nothing else, so a site embedding this learns its size and nothing about
 * the person using it. public/embed.js is the other half.
 *
 * ResizeObserver rather than firing on step changes: the height moves for
 * reasons a step change does not capture — a validation message appearing, a
 * long question wrapping, a slot list loading — and watching the element
 * itself catches all of them without anybody having to remember to announce
 * a new one.
 *
 * Two message names go out, from one observer. `intro:height` is what
 * public/embed.js listens for; `booking:resize` is the name this product
 * shipped with first, and there may be a host page still listening for it.
 * Sending both costs a function call and means an existing embed does not
 * silently stop resizing the day somebody upgrades.
 *
 * The wildcard target origin is deliberate and safe in this direction: we do
 * not know which customer's site has embedded this, the payload is a number,
 * and the receiving script verifies both the origin and the frame identity
 * before acting on it. Never accept an inbound message on this channel
 * without the same checks.
 */
export function useHostHeight(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return;

    let last = 0;
    const report = () => {
      const height = Math.ceil(document.documentElement.scrollHeight);
      if (height === last) return;
      last = height;
      window.parent.postMessage({ type: 'intro:height', height }, '*');
      window.parent.postMessage({ type: 'booking:resize', height }, '*');
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(document.documentElement);
    window.addEventListener('load', report);

    return () => {
      observer.disconnect();
      window.removeEventListener('load', report);
    };
  }, []);
}
