import type { ForgotMethods, ForgotResetInput } from '@/api';

/** A way to erase the device without its password. */
export type ForgotMethod = 'usb' | 'seed';

/** The word typed to confirm. */
export const CONFIRM_WORD = 'ERASE';

/** The methods this connection may use, the USB cable first (it works on every device). */
export function availableMethods(methods: ForgotMethods): ForgotMethod[] {
  const out: ForgotMethod[] = [];
  if (methods.usb) out.push('usb');
  if (methods.seed) out.push('seed');
  return out;
}

export interface ForgotForm {
  method: ForgotMethod;
  serial: string;
  seedPassword: string;
  confirm: string;
}

/** Whether the form is complete enough to send; the hub checks the values themselves. */
export function canErase(form: ForgotForm): boolean {
  if (form.confirm !== CONFIRM_WORD) return false;
  return form.method === 'usb' ? form.serial.trim().length > 0 : form.seedPassword.length > 0;
}

export function toResetInput(form: ForgotForm): ForgotResetInput {
  return form.method === 'usb'
    ? { method: 'usb', serial: form.serial.trim(), confirm: form.confirm }
    : { method: 'seed', seedPassword: form.seedPassword, confirm: form.confirm };
}
