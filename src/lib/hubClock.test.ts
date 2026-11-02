import { afterEach, describe, expect, it } from 'vitest';
import { hubNow, noteDateHeader, noteEventTime, resetHubClock } from './hubClock';

describe('hub clock', () => {
  afterEach(resetHubClock);

  it('follows a hub that is far behind', () => {
    const local = Date.now();
    noteEventTime(local - 500 * 86_400_000, local);
    expect(Math.abs(hubNow() - (Date.now() - 500 * 86_400_000))).toBeLessThan(1000);
  });

  it('takes the Date header until events give a finer offset', () => {
    const local = Date.parse('2026-10-15T10:00:00Z');
    noteDateHeader('Thu, 29 May 2025 21:00:00 GMT', local);
    const fromHeader = hubNow() - Date.now();
    expect(fromHeader).toBe(Date.parse('2025-05-29T21:00:00Z') - local);
    noteEventTime(local - 1000, local);
    noteDateHeader('Thu, 29 May 2025 21:00:00 GMT', local);
    expect(Math.abs(hubNow() - Date.now() + 1000)).toBeLessThan(50);
  });

  it('ignores a missing or unreadable header', () => {
    noteDateHeader(null);
    noteDateHeader('soon');
    expect(Math.abs(hubNow() - Date.now())).toBeLessThan(50);
  });
});
