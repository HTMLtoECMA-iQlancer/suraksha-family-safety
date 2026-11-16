import { describe, expect, it } from 'vitest';
import { bytes, duration, initials, isToday, titleCase, clockTime, dateTime } from './format';

describe('format helpers', () => {
  it('formats durations in English and Gujarati', () => {
    expect(duration(0)).toBe('0m');
    expect(duration(45)).toBe('45m');
    expect(duration(60)).toBe('1h');
    expect(duration(135)).toBe('2h 15m');
    expect(duration(-10)).toBe('0m');
    expect(duration(135, 'gu')).toBe('2કલાક 15મિનિટ');
  });

  it('formats byte sizes', () => {
    expect(bytes(512)).toBe('512 B');
    expect(bytes(2048)).toBe('2.0 KB');
    expect(bytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('builds initials and titles from identifiers', () => {
    expect(initials('Meera Shah')).toBe('MS');
    expect(initials('Aarav')).toBe('A');
    expect(titleCase('session.approved_by_child')).toBe('Session Approved By Child');
    expect(titleCase('screen-time')).toBe('Screen Time');
  });

  it('handles missing timestamps', () => {
    expect(clockTime(null)).toBe('—');
    expect(dateTime(undefined)).toBe('—');
  });

  it('recognises today', () => {
    expect(isToday(new Date().toISOString())).toBe(true);
    expect(isToday('2020-01-01T10:00:00.000Z')).toBe(false);
  });
});
