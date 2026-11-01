/**
 * Resizes an embedded khloe booking widget to fit its content.
 *
 * Without this the embed technically works and feels broken. The widget's
 * height changes enormously as someone moves through it — a short list of
 * services, then a page of questions, then a calendar, then a form — and a
 * fixed-height iframe either scrolls inside itself, which is miserable on a
 * phone, or cuts the confirmation off the bottom.
 *
 * Drop-in: the page needs only an <iframe> pointing at a /t/<slug> URL and
 * one <script src=".../embed.js" async>. No configuration, no init call.
 *
 * Security notes, since this runs on somebody else's site:
 *
 *   - It only ever listens. Nothing here lets the framed page run code,
 *     read the host page, navigate it or touch its cookies. The single
 *     effect available to the widget is setting the height of its own frame.
 *   - Every message is matched to the exact iframe it came from by comparing
 *     event.source against that frame's contentWindow, so another frame on
 *     the page — an ad, an unrelated embed — cannot resize this one.
 *   - The origin is checked against the frame's own src, so a message from
 *     anywhere other than the khloe host is ignored.
 *   - The height is clamped. A hostile or broken value cannot turn the host
 *     page into a hundred thousand pixels of scrollbar.
 *
 * It also tells khloe, once per page load, whether the booking page loaded
 * here, so the business's Share page can say "Working on <this page>" or
 * "your code is here but this site isn't allowed yet". The report is this
 * page's address without query or fragment, and a yes or no: nothing about
 * the visitor. A frame that a browser refused to show never sends a height,
 * so "no height within a while of being on screen" is how a refusal looks
 * from out here.
 */
(function () {
  'use strict';

  var MIN_HEIGHT = 320;
  var MAX_HEIGHT = 5000;

  function originOf(url) {
    try {
      return new URL(url, window.location.href).origin;
    } catch (e) {
      return null;
    }
  }

  /** Every iframe on this page that points at an khloe booking page. */
  function widgets() {
    var found = [];
    var frames = document.getElementsByTagName('iframe');
    for (var i = 0; i < frames.length; i += 1) {
      var src = frames[i].getAttribute('src') || '';
      if (/\/t\/[^/?#]+/.test(src)) found.push(frames[i]);
    }
    return found;
  }

  var WAIT_MS = 12000;
  var reported = [];

  /** Tell khloe whether this frame loaded, once per frame per page load. */
  function report(frame, ok) {
    if (reported.indexOf(frame) !== -1) return;
    reported.push(frame);
    var src = frame.getAttribute('src') || '';
    var match = /\/t\/([^/?#]+)/.exec(src);
    var origin = originOf(src);
    if (!match || !origin || origin === window.location.origin) return;
    if (!/^https?:$/.test(window.location.protocol)) return;
    var url = origin + '/api/t/' + match[1] + '/embed-check';
    var body = JSON.stringify({ page: window.location.origin + window.location.pathname, ok: ok });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, body)) return;
    } catch (e) {
      /* fall through */
    }
    try {
      fetch(url, { method: 'POST', body: body, mode: 'no-cors', keepalive: true, credentials: 'omit' });
    } catch (e) {
      /* Reporting is a courtesy; never disturb the page. */
    }
  }

  /** Start the clock on a frame once somebody could see it (it loads lazily). */
  function watch(frame) {
    if (frame.__khloeWatched) return;
    frame.__khloeWatched = true;
    var start = function () {
      window.setTimeout(function () {
        report(frame, false);
      }, WAIT_MS);
    };
    if (!('IntersectionObserver' in window)) return start();
    var seen = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i += 1) {
        if (entries[i].isIntersecting) {
          seen.disconnect();
          start();
          return;
        }
      }
    });
    seen.observe(frame);
  }

  function watchAll() {
    var frames = widgets();
    for (var i = 0; i < frames.length; i += 1) watch(frames[i]);
  }

  // Website tools often add the code after the page has loaded.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchAll);
  else watchAll();
  window.setTimeout(watchAll, 3000);

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.type !== 'khloe:height') return;

    var height = Number(data.height);
    if (!isFinite(height)) return;
    height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(height)));

    var frames = widgets();
    for (var i = 0; i < frames.length; i += 1) {
      var frame = frames[i];
      // Identity, not just origin: two khloe widgets on one page must not
      // resize each other, and nor must anything else that happens to be
      // served from the same host.
      if (frame.contentWindow !== event.source) continue;
      if (event.origin !== originOf(frame.getAttribute('src') || '')) continue;

      report(frame, true);
      frame.style.height = height + 'px';
      // A widget that has announced its height has no reason to scroll
      // inside itself, and an inner scrollbar on a phone is the exact
      // failure this script exists to prevent.
      frame.setAttribute('scrolling', 'no');
      frame.style.overflow = 'hidden';
    }
  });
})();
