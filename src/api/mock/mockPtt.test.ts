import { describe, expect, it } from 'vitest';
import { wavDuration } from './mockPtt';

function wav(dataBytes: number, format = 1, byteRate = 32_000): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const put = (at: number, text: string) => [...text].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  put(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, byteRate, true);
  put(36, 'data');
  view.setUint32(40, dataBytes, true);
  return buffer;
}

describe('mock test recording', () => {
  it('reads the duration from a PCM WAV header', () => {
    expect(wavDuration(wav(64_000), 44 + 64_000)).toBe(2000);
  });

  it('says why a file is not usable', () => {
    expect(wavDuration(new ArrayBuffer(8), 8)).toBe('This is not a WAV file.');
    expect(wavDuration(wav(100, 3), 144)).toBe('Only PCM WAV files can be sent.');
  });
});
