import { describe, expect, it } from 'vitest';
import { compareVersions, inspectBundle } from './mockOs';

describe('mock OS bundles', () => {
  it('takes an eMMC bundle for this board', () => {
    expect(inspectBundle('image-stm32mp1-kaonic1s-r30-v0.3.4-emmc.tar.gz')).toEqual({ version: '0.3.4' });
  });

  it('refuses another board, the SD card bundle and other files', () => {
    expect(inspectBundle('image-stm32mp1-kaonic1s-r24-v0.3.4-emmc.tar.gz')).toEqual({ error: expect.stringContaining('kaonic1s-r24') });
    expect(inspectBundle('image-stm32mp1-kaonic1s-r30-v0.3.4-sdcard-usb.tar.gz')).toEqual({ error: expect.stringContaining('eMMC') });
    expect(inspectBundle('holiday.tar.gz')).toEqual({ error: expect.stringContaining('not a Kaonic image') });
  });

  it('compares versions by number', () => {
    expect(compareVersions('0.10.0', '0.9.3')).toBe(1);
    expect(compareVersions('0.3.3', '0.3.3')).toBe(0);
    expect(compareVersions('0.3.2', '0.3.3')).toBe(-1);
  });
});
