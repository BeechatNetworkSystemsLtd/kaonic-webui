import { describe, expect, it } from 'vitest';
import type { RadioConfig } from '@/api';
import { centreHz, centreInBand, draftProblems } from './RadioConfigFields';

const SUB_GHZ = {
  minHz: 389_500_000,
  maxHz: 1_020_000_000,
  rangesHz: [
    [389_500_000, 510_000_000],
    [779_000_000, 1_020_000_000],
  ] as [number, number][],
};

const base: RadioConfig = { frequencyHz: 869_535_000, channelSpacingHz: 200_000, channel: 11, modulation: { kind: 'ofdm', mcs: 6, option: 1 }, txPower: 10 };

describe('radio band checks', () => {
  it('tunes to frequency + channel × spacing', () => {
    expect(centreHz(base)).toBe(871_735_000);
  });

  it('wants the channel centre inside one of the band ranges', () => {
    expect(centreInBand(871_735_000, SUB_GHZ)).toBe(true);
    // Between the two sub-GHz ranges.
    expect(centreInBand(600_000_000, SUB_GHZ)).toBe(false);
    expect(draftProblems({ ...base, frequencyHz: 600_000_000, channel: 0 }, SUB_GHZ).frequencyHz).toMatch(/outside/);
    // A base frequency in range whose channel pushes the centre past the top.
    expect(draftProblems({ ...base, frequencyHz: 1_019_000_000, channel: 10 }, SUB_GHZ).frequencyHz).toBeDefined();
    expect(draftProblems(base, SUB_GHZ)).toEqual({});
  });

  it('checks spacing, FSK preamble and listen-before-talk ranges, never an off band', () => {
    const problems = draftProblems(
      {
        ...base,
        channelSpacingHz: 0,
        modulation: { kind: 'fsk', preamble: 2000 },
        cca: { enabled: true, thresholdDbm: 10, listenUs: 9000, retries: 300, backoffUs: 3000 },
      },
      SUB_GHZ,
    );
    // Zero spacing leaves the centre on the base frequency, which is in the band.
    expect(Object.keys(problems).sort()).toEqual(['cca.backoffUs', 'cca.listenUs', 'cca.retries', 'cca.thresholdDbm', 'channelSpacingHz', 'modulation.preamble'].sort());
    expect(draftProblems({ ...base, frequencyHz: 1, modulation: { kind: 'off' } }, SUB_GHZ)).toEqual({});
  });
});
