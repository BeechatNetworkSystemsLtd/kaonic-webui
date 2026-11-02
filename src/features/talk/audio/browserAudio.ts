import captureWorklet from './capture.worklet.ts?worker&url';
import playbackWorklet from './playback.worklet.ts?worker&url';
import { Downsampler, FrameAssembler, int16ToFloat, levelOf, Upsampler } from './pcm';

/*
 * The browser's side of push-to-talk: the microphone as 20 ms 16 kHz frames
 * for the hub, and the group's frames played back through a jitter buffer.
 * Both need a user gesture to start (browsers keep audio off until then), and
 * the microphone needs a secure page: the hub serves HTTPS.
 */

/** Why the microphone cannot be used, in words for the user. */
export function microphoneProblem(error: unknown): string {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'The browser only allows the microphone on a secure page. Open this page over HTTPS (https://…), as the device serves it.';
  }
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The browser blocked the microphone. Allow it for this page (the lock or camera icon in the address bar), then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'This computer or phone has no microphone the browser can use.';
  if (name === 'NotReadableError') return 'Another app is using the microphone.';
  return 'The microphone could not be opened.';
}

/** An analyser for the level animation: fine enough for its bars, smoothed so they do not strobe (as the plugin's). */
function makeAnalyser(context: AudioContext): AnalyserNode {
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.72;
  analyser.minDecibels = -80;
  analyser.maxDecibels = -18;
  return analyser;
}

export const microphoneSupported = () =>
  typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof AudioWorkletNode !== 'undefined';

/** The microphone, cut into the hub's frames while `onFrame` wants them. */
export class Microphone {
  private constructor(
    private readonly context: AudioContext,
    private readonly stream: MediaStream,
    private readonly node: AudioWorkletNode,
    /** What the microphone hears, for the level animation. */
    readonly analyser: AnalyserNode,
  ) {}

  /** Throws with a `microphoneProblem` message when the browser says no. */
  static async open(onFrame: (frame: Int16Array, level: number) => void, gain: () => number): Promise<Microphone> {
    if (!window.isSecureContext || !microphoneSupported()) throw new Error(microphoneProblem(null));
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      throw new Error(microphoneProblem(error), { cause: error });
    }
    const context = new AudioContext({ latencyHint: 'interactive' });
    await context.audioWorklet.addModule(captureWorklet);
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, 'kaonic-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
    const downsampler = new Downsampler(context.sampleRate);
    const assembler = new FrameAssembler();
    node.port.onmessage = (message: MessageEvent<Float32Array>) => {
      for (const frame of assembler.push(downsampler.push(message.data), gain())) onFrame(frame, levelOf(frame));
    };
    source.connect(node);
    const analyser = makeAnalyser(context);
    source.connect(analyser);
    return new Microphone(context, stream, node, analyser);
  }

  close() {
    this.node.port.onmessage = null;
    this.node.disconnect();
    this.stream.getTracks().forEach((track) => track.stop());
    void this.context.close();
  }
}

/** Plays the group's frames in this browser. */
export class Speaker {
  private readonly upsampler: Upsampler;

  private constructor(
    private readonly context: AudioContext,
    private readonly node: AudioWorkletNode,
    /** What plays, for the level animation. */
    readonly analyser: AnalyserNode,
  ) {
    this.upsampler = new Upsampler(16_000, context.sampleRate);
  }

  static async open(): Promise<Speaker> {
    const context = new AudioContext({ latencyHint: 'interactive' });
    await context.audioWorklet.addModule(playbackWorklet);
    const node = new AudioWorkletNode(context, 'kaonic-playback', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    node.connect(context.destination);
    const analyser = makeAnalyser(context);
    node.connect(analyser);
    if (context.state === 'suspended') await context.resume();
    return new Speaker(context, node, analyser);
  }

  play(frame: Int16Array) {
    const samples = this.upsampler.push(Array.from(frame, int16ToFloat));
    this.node.port.postMessage(samples, [samples.buffer]);
  }

  /** Drops what is waiting to play. */
  clear() {
    this.node.port.postMessage({ clear: true });
  }

  close() {
    this.node.disconnect();
    void this.context.close();
  }
}
