/*
 * Microphone capture: passes the first input channel to the page in blocks of
 * about 10 ms (the page downsamples and frames it), so the audio thread does
 * no more than copy.
 */

const BLOCK = 512;

class CaptureProcessor extends AudioWorkletProcessor {
  private block = new Float32Array(BLOCK);
  private filled = 0;

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let index = 0; index < channel.length; index += 1) {
      this.block[this.filled] = channel[index]!;
      this.filled += 1;
      if (this.filled === BLOCK) {
        this.port.postMessage(this.block, [this.block.buffer]);
        this.block = new Float32Array(BLOCK);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('kaonic-capture', CaptureProcessor);
