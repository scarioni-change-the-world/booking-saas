'use client';

import { useEffect, useRef, useState } from 'react';
import { BOX_EVENT, openAskKhloe } from './AskKhloe';

/**
 * Ask khloe, inline: a box on the pages where people get stuck, looking
 * like what it is, somewhere to type what you want. Pressing Enter opens
 * the assistant with the question already asked. The corner key is easy to
 * miss; a box in the page is where people look first.
 */
export function AskKhloeBox({ example }: { example: string }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLFormElement>(null);

  // Tell the corner key whether this box is in view, so only one shows.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const say = (visible: boolean) => window.dispatchEvent(new CustomEvent(BOX_EVENT, { detail: { visible } }));
    const watch = new IntersectionObserver(([entry]) => say(!!entry?.isIntersecting), { threshold: 0.5 });
    watch.observe(el);
    return () => {
      watch.disconnect();
      say(false);
    };
  }, []);

  return (
    <form
      ref={ref}
      className="ak-box"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        openAskKhloe(text);
        setText('');
      }}
    >
      <span className="ak-box-mark" aria-hidden="true">
        ✦
      </span>
      <input
        type="text"
        aria-label="Ask khloe: what do you want to change?"
        placeholder={`Ask khloe what you want to change, e.g. “${example}”`}
        value={text}
        maxLength={1000}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className="btn-primary">
        Ask
      </button>
    </form>
  );
}
