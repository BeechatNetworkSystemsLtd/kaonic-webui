import type { Modulation, RadioTestRequest, TxPowerMax } from './types';

/**
 * The radio limits the hub enforces, so the page can show them before sending and the mock
 * answers with them: the TX power allowed per modulation, and what a test message may be.
 */

export type FieldErrors = Record<string, string>;

/** The TX power register goes to 31. */
export const TX_POWER_REGISTER_MAX = 31;
/** OFDM MCS 0 to 6. */
export const OFDM_MCS_COUNT = 7;
/** O-QPSK rate modes 0 to 4. */
export const QPSK_RATE_MODE_COUNT = 5;
/** The FSK symbol rates the radio offers, in kHz; the FSK limits come in this order. */
export const FSK_SYMBOL_RATES_KHZ = [50, 100, 150, 200, 300, 400] as const;

/** What a hub too old to report its board's limits allows: 25 with OFDM, 20 with QPSK and FSK. */
export const TX_POWER_MAX_FALLBACK: TxPowerMax = {
  ofdm: Array<number>(OFDM_MCS_COUNT).fill(25),
  qpsk: Array<number>(QPSK_RATE_MODE_COUNT).fill(20),
  fsk: Array<number>(FSK_SYMBOL_RATES_KHZ.length).fill(20),
};

/** The limit at `index`; out of range, the lowest of the table. */
function rate(limits: number[], index: number): number {
  return limits[index] ?? Math.min(...limits, TX_POWER_REGISTER_MAX);
}

/** The highest TX power with this modulation, from the band's limits as the board reports them. */
export function maxTxPower(modulation: Modulation, limits: TxPowerMax = TX_POWER_MAX_FALLBACK): number {
  switch (modulation.kind) {
    case 'ofdm':
      return rate(limits.ofdm, modulation.mcs);
    case 'qpsk':
      return rate(limits.qpsk, modulation.rateMode);
    case 'fsk':
      // Without a symbol rate: the lowest of the table.
      return rate(limits.fsk, FSK_SYMBOL_RATES_KHZ.findIndex((khz) => khz === modulation.symbolRateKhz));
    case 'off':
      return TX_POWER_REGISTER_MAX;
  }
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
