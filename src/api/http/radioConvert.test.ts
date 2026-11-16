import { describe, expect, it } from 'vitest';
import type { RadioConfig } from '../types';
import { fromRadioConfig, toRadioConfig } from './convert';

const base: RadioConfig = { frequencyHz: 869_535_000, channelSpacingHz: 200_000, channel: 11, modulation: { kind: 'ofdm', mcs: 6, option: 1 }, txPower: 10 };

describe('radio config on the wire', () => {
  it('round-trips every field, and leaves out what was left out', () => {
    const full: RadioConfig = {
      ...base,
      modulation: { kind: 'fsk', symbolRateKhz: 100, modulationIndex: 1, order: 4, bt: 2, fec: true, whitening: false, preamble: 64 },
      fcs: true,
      cca: { enabled: false, thresholdDbm: -90, listenUs: 128, retries: 10, backoffUs: 300 },
      frontend: { agcMap: 1, agcTarget: 5, lnaBypass: true },
    };
    const wire = fromRadioConfig(full);
    expect(wire.modulation).toEqual({ kind: 'fsk', symbol_rate_khz: 100, modulation_index: 1, order: 4, bt: 2, fec: true, whitening: false, preamble: 64 });
    expect(wire.cca).toEqual({ enabled: false, threshold_dbm: -90, listen_us: 128, retries: 10, backoff_us: 300 });
    expect(toRadioConfig(wire)).toEqual(full);
    const minimal = fromRadioConfig(base);
    expect('cca' in minimal || 'frontend' in minimal || 'fcs' in minimal).toBe(false);
  });
});

describe('radio tests on the wire', () => {
  it('reads a run, and a band that ran none as null', async () => {
    const { toRadioTest, fromRadioTestRequest } = await import('./convert');
    expect(toRadioTest({ running: false })).toBeNull();
    expect(toRadioTest(null)).toBeNull();
    expect(toRadioTest({ running: true, sent: 3, failed: 1, bytes: 5, interval_ms: 1000, count: null, started_ts_ms: 42, last_error: 'busy' })).toEqual({
      running: true,
      sent: 3,
      failed: 1,
      bytes: 5,
      intervalMs: 1000,
      count: null,
      startedAt: 42,
      lastError: 'busy',
    });
    expect(fromRadioTestRequest({ message: 'hi', format: 'text' })).toEqual({ message: 'hi', format: 'text' });
    expect(fromRadioTestRequest({ message: 'hi', format: 'hex', intervalMs: 500, count: 2 })).toEqual({ message: 'hi', format: 'hex', interval_ms: 500, count: 2 });
  });
});
