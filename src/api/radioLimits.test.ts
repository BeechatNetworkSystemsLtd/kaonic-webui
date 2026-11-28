import { describe, expect, it } from 'vitest';
import { maxTxPower, testPayload, testProblems } from './radioLimits';
import type { Modulation, TxPowerMax } from './types';

describe('radio limits', () => {
  it('takes the band\'s limits, else 25 with OFDM and 20 with QPSK and FSK', () => {
    const ofdm = (mcs: number, limits?: TxPowerMax) => maxTxPower({ kind: 'ofdm', mcs, option: 1 } as Modulation, limits);
    expect([0, 3, 6].map((mcs) => ofdm(mcs))).toEqual([25, 25, 25]);
    expect([maxTxPower({ kind: 'qpsk' } as Modulation), maxTxPower({ kind: 'fsk' } as Modulation), maxTxPower({ kind: 'off' })]).toEqual([20, 20, 31]);
    const kaonic1x: TxPowerMax = { ofdm: [25, 25, 25, 25, 23, 21, 19], qpsk: [20, 20, 20, 18, 18], fsk: [20, 20, 20, 20, 17, 16] };
    expect([0, 3, 4, 5, 6].map((mcs) => ofdm(mcs, kaonic1x))).toEqual([25, 25, 23, 21, 19]);
    // O-QPSK by rate mode, FSK by symbol rate.
    expect(maxTxPower({ kind: 'qpsk', chipRateKhz: 1000, rateMode: 4 }, kaonic1x)).toBe(18);
    expect(maxTxPower({ kind: 'fsk', symbolRateKhz: 400 }, kaonic1x)).toBe(16);
    expect(maxTxPower({ kind: 'fsk', symbolRateKhz: 100 }, kaonic1x)).toBe(20);
  });

  it('reads a test message as text or hex bytes, up to one frame', () => {
    expect(testPayload('KAO', 'text')).toEqual({ bytes: new Uint8Array([0x4b, 0x41, 0x4f]) });
    expect(testPayload('4b:41 4F', 'hex')).toEqual({ bytes: new Uint8Array([0x4b, 0x41, 0x4f]) });
    expect(testPayload('0x4b414f', 'hex')).toEqual({ bytes: new Uint8Array([0x4b, 0x41, 0x4f]) });
    for (const bad of ['4b4', 'zz', '']) expect(testPayload(bad, 'hex')).toHaveProperty('problem');
    expect(testPayload('', 'text')).toHaveProperty('problem');
    expect(testPayload('x'.repeat(2047), 'text')).toHaveProperty('bytes');
    expect(testPayload('x'.repeat(2048), 'text')).toHaveProperty('problem');
    // Bytes, not characters.
    expect(testPayload('é'.repeat(1024), 'text')).toHaveProperty('problem');
  });

  it('checks the interval and count as the hub does', () => {
    expect(testProblems({ message: 'a', format: 'text' })).toEqual({});
    expect(testProblems({ message: 'a', format: 'text', intervalMs: 1000, count: 5 })).toEqual({});
    expect(Object.keys(testProblems({ message: 'a', format: 'text', intervalMs: 99 }))).toEqual(['intervalMs']);
    expect(Object.keys(testProblems({ message: 'a', format: 'text', count: 5 }))).toEqual(['count']);
    expect(Object.keys(testProblems({ message: 'a', format: 'text', intervalMs: 1000, count: 0 }))).toEqual(['count']);
    expect(Object.keys(testProblems({ message: 'a', format: 'text', intervalMs: Number.NaN }))).toEqual(['intervalMs']);
  });
});
