/*
 * The playback side's jitter buffer, in samples at the output rate. Frames
 * arrive in bursts over the radio; playing starts only once `target` samples
 * are held, so short gaps do not click. An empty buffer plays silence and
 * waits for `target` again, and one that grows past `max` (a backlog after a
 * stall) drops its oldest samples so the delay stays small. Pure: it runs in
 * the playback worklet and in tests.
 */

export class JitterBuffer {
  private chunks: Float32Array[] = [];
  private head = 0;
  private held = 0;
  private playing = false;
  /** Samples dropped to keep the delay down, and times playback ran dry. */
  dropped = 0;
  underruns = 0;

  constructor(
    private readonly target: number,
    private readonly max: number,
  ) {}

  get buffered(): number {
    return this.held;
  }

  push(samples: Float32Array) {
    if (samples.length === 0) return;
    this.chunks.push(samples);
    this.held += samples.length;
    while (this.held > this.max) {
      const first = this.chunks[0]!;
      const excess = this.held - this.max;
      const left = first.length - this.head;
      if (left <= excess) {
        this.chunks.shift();
        this.head = 0;
        this.held -= left;
        this.dropped += left;
      } else {
        this.head += excess;
        this.held -= excess;
        this.dropped += excess;
      }
    }
  }

  /** Fills `out`: buffered audio, or silence while (re)buffering. */
  pull(out: Float32Array) {
    if (!this.playing && this.held >= this.target) this.playing = true;
    let written = 0;
    if (this.playing) {
      while (written < out.length && this.chunks.length > 0) {
        const chunk = this.chunks[0]!;
        const count = Math.min(out.length - written, chunk.length - this.head);
        out.set(chunk.subarray(this.head, this.head + count), written);
        written += count;
        this.head += count;
        this.held -= count;
        if (this.head === chunk.length) {
          this.chunks.shift();
          this.head = 0;
        }
      }
      if (written < out.length) {
        this.playing = false;
        this.underruns += 1;
      }
    }
    out.fill(0, written);
  }

  clear() {
    this.chunks = [];
    this.head = 0;
    this.held = 0;
    this.playing = false;
  }
}
