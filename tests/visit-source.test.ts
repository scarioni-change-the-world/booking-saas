import { describe, expect, it } from 'vitest';
import { classifySource, sourceLabel } from '../src/lib/visit-source';

const base = { search: '', referrer: '', ownHost: 'intro.app', embedded: false };

describe('classifySource', () => {
  it('trusts a label the business put on its own link', () => {
    expect(classifySource({ ...base, search: '?ref=instagram' })).toBe('instagram');
    expect(classifySource({ ...base, search: '?utm_source=IG' })).toBe('instagram');
    expect(classifySource({ ...base, search: '?ref=Spring Newsletter!' })).toBe('spring newsletter');
    expect(classifySource({ ...base, search: '?ref=newsletter' })).toBe('email');
  });

  it('names the platforms a practice posts on from the referring site', () => {
    expect(classifySource({ ...base, referrer: 'https://l.instagram.com/?u=x' })).toBe('instagram');
    expect(classifySource({ ...base, referrer: 'https://www.google.es/' })).toBe('google');
    expect(classifySource({ ...base, referrer: 'https://t.co/abc' })).toBe('x');
    expect(classifySource({ ...base, referrer: 'https://mail.google.com/' })).toBe('email');
    expect(classifySource({ ...base, referrer: 'https://lnkd.in/xyz' })).toBe('linkedin');
  });

  it('keeps any other site as its host, and says direct when nothing does', () => {
    expect(classifySource({ ...base, referrer: 'https://www.mara-studio.com/contact' })).toBe(
      'mara-studio.com',
    );
    expect(classifySource(base)).toBe('direct');
    expect(classifySource({ ...base, referrer: 'https://intro.app/t/mara' })).toBe('direct');
  });

  it('reads an embedded page as the website it sits in', () => {
    expect(classifySource({ ...base, embedded: true, referrer: 'https://mara-studio.com/book' })).toBe(
      'mara-studio.com',
    );
    expect(classifySource({ ...base, embedded: true })).toBe('your website');
  });
});

describe('sourceLabel', () => {
  it('reads as a person would say it', () => {
    expect(sourceLabel('instagram')).toBe('Instagram');
    expect(sourceLabel(null)).toBe('Direct or unknown');
    expect(sourceLabel('client_link')).toBe('Their own link');
    expect(sourceLabel('mara-studio.com')).toBe('mara-studio.com');
  });
});
