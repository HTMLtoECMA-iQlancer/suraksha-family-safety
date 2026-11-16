import { describe, expect, it } from 'vitest';
import { en, gu, type MessageKey } from './i18n';

const enKeys = Object.keys(en) as MessageKey[];
const guKeys = Object.keys(gu) as MessageKey[];

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

describe('translation dictionaries', () => {
  it('only translates keys that exist in English', () => {
    const orphans = guKeys.filter((key) => !(key in en));
    expect(orphans).toEqual([]);
  });

  it('keeps placeholders consistent between languages', () => {
    const mismatched = guKeys.filter((key) => {
      const source = placeholders(en[key]);
      const translated = placeholders(gu[key] ?? '');
      return source.join(',') !== translated.join(',');
    });
    expect(mismatched).toEqual([]);
  });

  it('has no empty strings', () => {
    const emptyEnglish = enKeys.filter((key) => !en[key].trim());
    const emptyGujarati = guKeys.filter((key) => !(gu[key] ?? '').trim());
    expect(emptyEnglish).toEqual([]);
    expect(emptyGujarati).toEqual([]);
  });

  it('covers the main navigation, consent and settings screens in Gujarati', () => {
    const required: MessageKey[] = [
      'nav.device',
      'nav.location',
      'nav.family',
      'nav.my',
      'settings.language',
      'privacy.title',
    ];
    for (const key of required) expect(gu[key], `missing Gujarati for ${key}`).toBeTruthy();
    expect(guKeys.length).toBeGreaterThan(150);
  });
});
