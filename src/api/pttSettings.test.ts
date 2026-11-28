import { describe, expect, it } from 'vitest';
import { fromPttSettings, toPttSettings } from './http/convert';
import { DEFAULT_PTT_SETTINGS, PTT_RANGES, pttSettingsProblems } from './pttSettings';

describe('push-to-talk settings', () => {
  it('starts from the plugin defaults, which are valid', () => {
    expect(DEFAULT_PTT_SETTINGS).toMatchObject({ talkInput: 'device', autoArm: true, squelchEnabled: true, squelchOpenDbfs: -50, opusBitrateBps: 20_000, packetFrames: 4 });
    expect(pttSettingsProblems(DEFAULT_PTT_SETTINGS, DEFAULT_PTT_SETTINGS)).toEqual({});
  });

  it('refuses values out of range or fractional where whole numbers are needed', () => {
    expect(pttSettingsProblems({ squelchOpenDbfs: -91, opusComplexity: 11, ttl: 2.5 }, DEFAULT_PTT_SETTINGS)).toEqual({
      squelchOpenDbfs: 'Use -90 to 0.',
      opusComplexity: 'Use 0 to 10.',
      ttl: 'Use a whole number.',
    });
    expect(pttSettingsProblems({ squelchHysteresisDb: 2.5 }, DEFAULT_PTT_SETTINGS)).toEqual({});
    expect(pttSettingsProblems({ captureDevice: ' ' }, DEFAULT_PTT_SETTINGS)).toEqual({ captureDevice: 'Choose a device.' });
  });

  it('lets the card levels be left alone', () => {
    expect(pttSettingsProblems({ volume: null, micGain: null }, DEFAULT_PTT_SETTINGS)).toEqual({});
    expect(pttSettingsProblems({ volume: 101 }, DEFAULT_PTT_SETTINGS)).toEqual({ volume: 'Use 0 to 100.' });
  });

  it('checks the pairs on the result, naming the field that was changed', () => {
    expect(pttSettingsProblems({ jitterTargetMs: 400 }, DEFAULT_PTT_SETTINGS)).toEqual({ jitterTargetMs: 'The maximum must be at least the target.' });
    expect(pttSettingsProblems({ jitterMaxMs: 100 }, DEFAULT_PTT_SETTINGS)).toEqual({ jitterMaxMs: 'The maximum must be at least the target.' });
    expect(pttSettingsProblems({ packetFrames: 8, packetFramesMax: 8 }, DEFAULT_PTT_SETTINGS)).toEqual({});
    expect(pttSettingsProblems({ packetFramesMax: 3 }, DEFAULT_PTT_SETTINGS)).toEqual({ packetFramesMax: 'The maximum must be at least the frames per packet.' });
  });

  it('has a range for every number setting', () => {
    const numbers = Object.entries(DEFAULT_PTT_SETTINGS).filter(([, value]) => typeof value === 'number' || value === null).map(([key]) => key);
    expect(Object.keys(PTT_RANGES).sort()).toEqual(numbers.sort());
  });

  it('maps every setting to the wire and back, and only what changed in a patch', () => {
    const wire = fromPttSettings(DEFAULT_PTT_SETTINGS);
    expect(Object.keys(wire)).toHaveLength(28);
    expect(wire).toMatchObject({ talk_input: 'device', squelch_preroll_ms: 120, opus_packet_loss_pct: 0, spectrum_bands: 14, volume: null });
    expect(toPttSettings(wire as Parameters<typeof toPttSettings>[0])).toEqual(DEFAULT_PTT_SETTINGS);
    expect(fromPttSettings({ rxWhileTx: true })).toEqual({ rx_while_tx: true });
  });
});
