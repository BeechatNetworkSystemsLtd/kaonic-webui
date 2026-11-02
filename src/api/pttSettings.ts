import type { PttSettings } from './types';

/*
 * Push-to-talk settings: the kaonic-audio-ptt plugin's defaults, and the
 * ranges the hub accepts (docs/api/openapi.yaml `PttSettings`), so the page
 * can say what is wrong before saving and the mock refuses what the hub would.
 */

export const DEFAULT_PTT_SETTINGS: PttSettings = {
  volume: null,
  micGain: null,
  captureDevice: 'default',
  playbackDevice: 'default',
  talkInput: 'device',
  playOnDevice: true,
  rxWhileTx: false,
  autoArm: true,
  squelchEnabled: true,
  squelchOpenDbfs: -45,
  squelchHysteresisDb: 6,
  squelchHangoverMs: 600,
  squelchPrerollMs: 120,
  jitterTargetMs: 120,
  jitterMaxMs: 320,
  opusBitrateBps: 20_000,
  opusComplexity: 5,
  opusDtx: true,
  opusFec: false,
  opusPacketLossPct: 0,
  opusCbr: false,
  packetFrames: 4,
  packetFramesMax: 8,
  packetAlignLdpc: true,
  relay: true,
  ttl: 4,
  spectrumEnabled: true,
  spectrumBands: 14,
};

type NumberKey = { [K in keyof PttSettings]: PttSettings[K] extends number | null ? K : never }[keyof PttSettings];

/** Inclusive range, and whether only whole numbers are allowed. */
export const PTT_RANGES: Record<NumberKey, { min: number; max: number; integer: boolean }> = {
  volume: { min: 0, max: 100, integer: true },
  micGain: { min: 0, max: 100, integer: true },
  squelchOpenDbfs: { min: -90, max: 0, integer: false },
  squelchHysteresisDb: { min: 0, max: 30, integer: false },
  squelchHangoverMs: { min: 0, max: 5000, integer: true },
  squelchPrerollMs: { min: 0, max: 1000, integer: true },
  jitterTargetMs: { min: 20, max: 1000, integer: true },
  jitterMaxMs: { min: 20, max: 2000, integer: true },
  opusBitrateBps: { min: 6000, max: 64_000, integer: true },
  opusComplexity: { min: 0, max: 10, integer: true },
  opusPacketLossPct: { min: 0, max: 100, integer: true },
  packetFrames: { min: 1, max: 8, integer: true },
  packetFramesMax: { min: 1, max: 16, integer: true },
  ttl: { min: 1, max: 8, integer: true },
  spectrumBands: { min: 4, max: 64, integer: true },
};

/**
 * What is wrong with `patch` applied to `current`, by field; empty when it is
 * fine. Pairs are checked on the result, so raising the target above the
 * current maximum is caught.
 */
export function pttSettingsProblems(patch: Partial<PttSettings>, current: PttSettings): Partial<Record<keyof PttSettings, string>> {
  const problems: Partial<Record<keyof PttSettings, string>> = {};
  for (const [key, range] of Object.entries(PTT_RANGES) as Array<[NumberKey, (typeof PTT_RANGES)[NumberKey]]>) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === null && (key === 'volume' || key === 'micGain')) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < range.min || value > range.max) {
      problems[key] = `Use ${range.min} to ${range.max}.`;
    } else if (range.integer && !Number.isInteger(value)) {
      problems[key] = 'Use a whole number.';
    }
  }
  for (const key of ['captureDevice', 'playbackDevice'] as const) {
    const value = patch[key];
    if (value !== undefined && (value.trim() === '' || value.length > 64)) problems[key] = 'Choose a device.';
  }
  const next = { ...current, ...patch };
  if (!problems.jitterMaxMs && !problems.jitterTargetMs && next.jitterMaxMs < next.jitterTargetMs) {
    problems[('jitterMaxMs' in patch ? 'jitterMaxMs' : 'jitterTargetMs') as keyof PttSettings] = 'The maximum must be at least the target.';
  }
  if (!problems.packetFramesMax && !problems.packetFrames && next.packetFramesMax < next.packetFrames) {
    problems[('packetFramesMax' in patch ? 'packetFramesMax' : 'packetFrames') as keyof PttSettings] = 'The maximum must be at least the frames per packet.';
  }
  return problems;
}
