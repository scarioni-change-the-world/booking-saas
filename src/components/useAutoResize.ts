'use client';

import { useEffect } from 'react';

/**
 * Report document height to the embedding page.
 *
 * The widget is embedded in an iframe on the tenant's marketing site, so the
 * host has no way to size it as the flow moves between steps. This is the
 * reference implementation's `postMessage` auto-resize, which worked well and
 * is kept — renamed from `doce-minutos-resize` to a product-neutral event, as
 * brief 7.2 asks.
 *
 * The message goes to '*' because the host origin varies per tenant and is not
 * known here. That is safe in this direction: the payload is a height, and a
 * height leaks nothing. Never accept an inbound message on the same channel
 * without checking its origin against the tenant's registered embed domains.
 */
export function useAutoResize(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return;

    let last = 0;
    const report = () => {
      const height = Math.ceil(document.documentElement.scrollHeight);
      if (height !== last) {
        last = height;
        window.parent.postMessage({ type: 'booking:resize', height }, '*');
      }
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
