/*
 * The AudioWorklet global scope, which TypeScript's DOM library leaves out.
 * Only what the two worklets in this folder use.
 */

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor & {
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
  },
): void;

/** The audio context's sample rate, as a worklet sees it. */
declare const sampleRate: number;
