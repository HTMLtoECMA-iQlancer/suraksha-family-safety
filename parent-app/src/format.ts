import type { Locale } from './i18n';

export function clockTime(iso: string | null | undefined, locale: Locale = 'en'): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(locale === 'gu' ? 'gu-IN' : 'en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function dateTime(iso: string | null | undefined, locale: Locale = 'en'): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale === 'gu' ? 'gu-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function shortDate(iso: string, locale: Locale = 'en'): string {
  return new Date(iso).toLocaleDateString(locale === 'gu' ? 'gu-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
  });
}

export function weekdayShort(iso: string, locale: Locale = 'en'): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(locale === 'gu' ? 'gu-IN' : 'en-IN', {
    weekday: 'short',
  });
}

export function relativeTime(iso: string | null | undefined, locale: Locale = 'en'): string {
  if (!iso) return '—';
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  const rtf = new Intl.RelativeTimeFormat(locale === 'gu' ? 'gu' : 'en', { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(seconds), 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86_400), 'day');
}

export function duration(minutes: number, locale: Locale = 'en'): string {
  const safe = Math.max(0, Math.round(minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  const hourLabel = locale === 'gu' ? 'કલાક' : 'h';
  const minuteLabel = locale === 'gu' ? 'મિનિટ' : 'm';
  if (h && m) return `${h}${hourLabel} ${m}${minuteLabel}`;
  if (h) return `${h}${hourLabel}`;
  return `${m}${minuteLabel}`;
}

export function bytes(amount: number): string {
  if (amount < 1024) return `${amount} B`;
  if (amount < 1024 * 1024) return `${(amount / 1024).toFixed(1)} KB`;
  return `${(amount / (1024 * 1024)).toFixed(1)} MB`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function titleCase(value: string): string {
  return value
    .replace(/[_.-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}
