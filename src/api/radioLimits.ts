import type { Modulation, RadioTestRequest } from './types';

/**
 * The radio limits the hub enforces, so the page can show them before sending and the mock
 * answers with them: the TX power allowed per modulation, and what a test message may be.
 */

export type FieldErrors = Record<string, string>;

/** The TX power register goes to 31; the hub allows 25 with OFDM and 20 with QPSK and FSK. */
export const TX_POWER_REGISTER_MAX = 31;
export const TX_POWER_MAX: Record<Modulation['kind'], number> = { ofdm: 25, qpsk: 20, fsk: 20, off: TX_POWER_REGISTER_MAX };

export function maxTxPower(kind: Modulation['kind']): number {
  return TX_POWER_MAX[kind];
}

/** One frame of the transceiver. */
export const TEST_MAX_BYTES = 2047;
export const TEST_MIN_INTERVAL_MS = 100;
export const TEST_MAX_INTERVAL_MS = 3_600_000;
export const TEST_MAX_COUNT = 1_000_000;

/** The message's bytes, or a problem with it. Hex allows spaces, colons and commas between bytes. */
export function testPayload(message: string, format: RadioTestRequest['format']): { bytes: Uint8Array } | { problem: string } {
  let bytes: Uint8Array;
  if (format === 'hex') {
    let digits = message.replace(/[\s:,]/g, '');
    if (digits.startsWith('0x')) digits = digits.slice(2);
    if (digits.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(digits)) return { problem: 'Use pairs of hex digits, such as 4b 41 4f.' };
    bytes = new Uint8Array(digits.length / 2);
    for (let at = 0; at < bytes.length; at++) bytes[at] = parseInt(digits.slice(at * 2, at * 2 + 2), 16);
  } else {
    bytes = new TextEncoder().encode(message);
  }
  if (bytes.length === 0) return { problem: 'Type a message to send.' };
  if (bytes.length > TEST_MAX_BYTES) return { problem: `Use at most ${TEST_MAX_BYTES} bytes; this is ${bytes.length}.` };
  return { bytes };
}

/** Problems with a test request, by field, as the hub reports them. */
export function testProblems(request: RadioTestRequest): FieldErrors {
  const problems: FieldErrors = {};
  const payload = testPayload(request.message, request.format);
  if ('problem' in payload) problems.message = payload.problem;
  if (request.intervalMs !== undefined && !(Number.isInteger(request.intervalMs) && request.intervalMs >= TEST_MIN_INTERVAL_MS && request.intervalMs <= TEST_MAX_INTERVAL_MS)) {
    problems.intervalMs = `Use ${TEST_MIN_INTERVAL_MS} ms to ${TEST_MAX_INTERVAL_MS / 60_000} minutes.`;
  }
  if (request.count !== undefined) {
    if (request.intervalMs === undefined) problems.count = 'A count needs an interval.';
    else if (!(Number.isInteger(request.count) && request.count >= 1 && request.count <= TEST_MAX_COUNT)) problems.count = `Use 1 to ${TEST_MAX_COUNT}.`;
  }
  return problems;
}
