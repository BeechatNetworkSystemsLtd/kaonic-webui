/*
 * Sample-rate conversion and framing between the browser's audio (float
 * samples at the audio context's rate, usually 48 kHz) and the hub's
 * (16-bit PCM, 16 kHz mono, 20 ms frames). Pure, so it is tested on its own and
 * runs both on the page and in the playback worklet.
 */

/** The hub's audio: 16 kHz mono, 20 ms frames. */
export const HUB_RATE = 16_000;
export const FRAME_SAMPLES = 320;

export function floatToInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
}

export const int16ToFloat = (sample: number): number => sample / 0x8000;

/** Loudness of a stretch of samples (either kind), 0..1, scaled so speech reads in the middle. */
export function levelOf(samples: ArrayLike<number>, fullScale = 0x8000): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index]! / fullScale;
    sum += value * value;
  }
  const rms = Math.sqrt(sum / samples.length);
  // -60 dBFS reads as 0, 0 dBFS as 1.
  const db = 20 * Math.log10(Math.max(rms, 1e-6));
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

/**
 * From a higher rate down to the hub's, a stream at a time: each output sample
 * is the average of the input samples it covers, which also filters out what
 * 16 kHz cannot carry.
 */
export class Downsampler {
  private readonly ratio: number;
  private pending: number[] = [];
  private position = 0;

  constructor(inputRate: number, outputRate = HUB_RATE) {
    if (inputRate < outputRate) throw new Error('Downsampler only goes down');
    this.ratio = inputRate / outputRate;
  }

  push(input: ArrayLike<number>): Float32Array {
    for (let index = 0; index < input.length; index += 1) this.pending.push(input[index]!);
    const out: number[] = [];
    while (this.position + this.ratio <= this.pending.length) {
      const start = this.position;
      const end = this.position + this.ratio;
      let sum = 0;
      let weight = 0;
      for (let index = Math.floor(start); index < Math.ceil(end); index += 1) {
        const cover = Math.min(end, index + 1) - Math.max(start, index);
        sum += this.pending[index]! * cover;
        weight += cover;
      }
      out.push(sum / weight);
      this.position = end;
    }
    const consumed = Math.floor(this.position);
    this.pending = this.pending.slice(consumed);
    this.position -= consumed;
    return Float32Array.from(out);
  }
}

/** From the hub's rate up to the audio context's, by linear interpolation, a stream at a time. */
export class Upsampler {
  private readonly step: number;
  private previous = 0;
  /** Where the next output sample falls, in input samples from `previous`. */
  private position = 0;

  constructor(inputRate = HUB_RATE, outputRate: number) {
    this.step = inputRate / outputRate;
  }

  push(input: ArrayLike<number>): Float32Array {
    const out: number[] = [];
    for (let index = 0; index < input.length; index += 1) {
      const next = input[index]!;
      while (this.position < 1) {
        out.push(this.previous + (next - this.previous) * this.position);
        this.position += this.step;
      }
      this.position -= 1;
      this.previous = next;
    }
    return Float32Array.from(out);
  }
}

/** Collects float samples at 16 kHz into whole 20 ms Int16 frames, with a gain. */
export class FrameAssembler {
  private buffer = new Float32Array(FRAME_SAMPLES);
  private filled = 0;

  push(samples: ArrayLike<number>, gain = 1): Int16Array[] {
    const frames: Int16Array[] = [];
    for (let index = 0; index < samples.length; index += 1) {
      this.buffer[this.filled] = samples[index]! * gain;
      this.filled += 1;
      if (this.filled === FRAME_SAMPLES) {
        frames.push(Int16Array.from(this.buffer, floatToInt16));
        this.filled = 0;
      }
    }
    return frames;
  }

  reset() {
    this.filled = 0;
  }
}

/** Mic gain as the settings give it (0-100, 50 is unchanged) to a multiplier: 0.25x to 4x. */
export const gainOf = (micGain: number): number => 2 ** ((Math.max(0, Math.min(100, micGain)) - 50) / 25);
