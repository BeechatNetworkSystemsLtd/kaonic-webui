import { JitterBuffer } from './jitter';

/*
 * Playback: the page posts samples already at this context's rate; they go
 * through a ~80 ms jitter buffer, and silence plays on gaps. `{ clear: true }`
 * drops what is held (the talker changed, or listening stopped).
 */

const TARGET_MS = 80;
const MAX_MS = 400;

class PlaybackProcessor extends AudioWorkletProcessor {
  private buffer = new JitterBuffer(Math.round((sampleRate * TARGET_MS) / 1000), Math.round((sampleRate * MAX_MS) / 1000));

  constructor() {
    super();
    this.port.onmessage = (message: MessageEvent<Float32Array | { clear: true }>) => {
      if (message.data instanceof Float32Array) this.buffer.push(message.data);
      else this.buffer.clear();
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    const first = output?.[0];
    if (!output || !first) return true;
    this.buffer.pull(first);
    for (let channel = 1; channel < output.length; channel += 1) output[channel]!.set(first);
    return true;
  }
}

registerProcessor('kaonic-playback', PlaybackProcessor);
