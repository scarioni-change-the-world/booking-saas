/**
 * Resizes an embedded intro booking widget to fit its content.
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
 *     anywhere other than the intro host is ignored.
 *   - The height is clamped. A hostile or broken value cannot turn the host
 *     page into a hundred thousand pixels of scrollbar.
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

  /** Every iframe on this page that points at an intro booking page. */
  function widgets() {
    var found = [];
    var frames = document.getElementsByTagName('iframe');
    for (var i = 0; i < frames.length; i += 1) {
      var src = frames[i].getAttribute('src') || '';
      if (/\/t\/[^/?#]+/.test(src)) found.push(frames[i]);
    }
    return found;
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.type !== 'intro:height') return;

    var height = Number(data.height);
    if (!isFinite(height)) return;
    height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(height)));

    var frames = widgets();
    for (var i = 0; i < frames.length; i += 1) {
      var frame = frames[i];
      // Identity, not just origin: two intro widgets on one page must not
      // resize each other, and nor must anything else that happens to be
      // served from the same host.
      if (frame.contentWindow !== event.source) continue;
      if (event.origin !== originOf(frame.getAttribute('src') || '')) continue;

      frame.style.height = height + 'px';
      // A widget that has announced its height has no reason to scroll
      // inside itself, and an inner scrollbar on a phone is the exact
      // failure this script exists to prevent.
      frame.setAttribute('scrolling', 'no');
      frame.style.overflow = 'hidden';
    }
  });
})();
