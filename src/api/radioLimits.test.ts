import { describe, expect, it } from 'vitest';
import { maxTxPower, testPayload, testProblems } from './radioLimits';

describe('radio limits', () => {
  it('allows 25 with OFDM, 20 with QPSK and FSK', () => {
    expect([maxTxPower('ofdm'), maxTxPower('qpsk'), maxTxPower('fsk'), maxTxPower('off')]).toEqual([25, 20, 20, 31]);
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
