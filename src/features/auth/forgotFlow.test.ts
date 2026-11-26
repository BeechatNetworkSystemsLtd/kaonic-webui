import { describe, expect, it } from 'vitest';
import { availableMethods, canErase, toResetInput, type ForgotForm } from './forgotFlow';

const form = (patch: Partial<ForgotForm> = {}): ForgotForm => ({ method: 'usb', serial: 'K1S-30-004217', words: Array(12).fill(''), confirm: 'ERASE', ...patch });

describe('forgotten password reset', () => {
  it('offers the USB cable first, the seed only on the admin device, nothing over the hotspot of a member', () => {
    expect(availableMethods({ usb: true, seed: true, setUp: true })).toEqual(['usb', 'seed']);
    expect(availableMethods({ usb: false, seed: true, setUp: true })).toEqual(['seed']);
    expect(availableMethods({ usb: false, seed: false, setUp: true })).toEqual([]);
  });

  it('needs the proof of the chosen method and ERASE typed exactly', () => {
    expect(canErase(form())).toBe(true);
    expect(canErase(form({ confirm: 'erase' }))).toBe(false);
    expect(canErase(form({ serial: '  ' }))).toBe(false);
    expect(canErase(form({ method: 'seed' }))).toBe(false);
    expect(canErase(form({ method: 'seed', words: Array(12).fill('zoo') }))).toBe(true);
    expect(canErase(form({ method: 'seed', words: [...Array(11).fill('zoo'), ''] }))).toBe(false);
  });

  it('sends only what the method needs', () => {
    expect(toResetInput(form({ serial: ' K1S-30-004217 ' }))).toEqual({ method: 'usb', serial: 'K1S-30-004217', confirm: 'ERASE' });
    expect(toResetInput(form({ method: 'seed', words: ['legal', 'winner'], serial: 'x' }))).toEqual({ method: 'seed', seedPhrase: 'legal winner', confirm: 'ERASE' });
  });
});
