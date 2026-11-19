/**
 * Money happens in its own tab: Stripe's pages (paying for a booking,
 * subscribing to khloe, the billing portal, connecting Stripe) open beside
 * khloe, so the page someone came from stays where it was, to check
 * something or come back to.
 *
 * The tab is opened at once, inside the click, because browsers block a
 * tab opened later (after the server answers with Stripe's address). It
 * says "Opening Stripe…" until the address arrives.
 */
export interface PendingTab {
  /** Sends the tab to the address. False when no tab could be opened. */
  go(url: string): boolean;
  /** Closes the tab: the server said no, so there is nowhere to go. */
  cancel(): void;
}

export function openPendingTab(): PendingTab {
  let tab: Window | null = null;
  try {
    tab = window.open('', '_blank');
  } catch {
    tab = null;
  }
  if (tab) {
    try {
      // Stripe's page has no business with the page that opened it.
      tab.opener = null;
      tab.document.title = 'Opening Stripe…';
      tab.document.body.style.cssText = 'font:16px system-ui,sans-serif;margin:3rem;color:#202221';
      tab.document.body.textContent = 'Opening Stripe’s secure page…';
    } catch {
      // Cosmetic only.
    }
  }
  return {
    go(url) {
      if (!tab || tab.closed) return false;
      tab.location.href = url;
      return true;
    },
    cancel() {
      if (tab && !tab.closed) tab.close();
    },
  };
}
