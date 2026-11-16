'use client';

import { useState } from 'react';
import { openAskKhloe } from './AskKhloe';

/**
 * Ask khloe, inline: a box on the pages where people get stuck, looking
 * like what it is, somewhere to type what you want. Pressing Enter opens
 * the assistant with the question already asked. The corner key is easy to
 * miss; a box in the page is where people look first.
 */
export function AskKhloeBox({ example }: { example: string }) {
  const [text, setText] = useState('');
  return (
    <form
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
