import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, errorMessage, isApiError, validationFields } from '@/api';
import { Button, Dialog, Field, Input, Notice, Segmented, Skeleton } from '@/ui';
import { availableMethods, canErase, CONFIRM_WORD, toResetInput, type ForgotForm, type ForgotMethod } from './forgotFlow';
import styles from './Auth.module.css';

const METHOD_LABELS: Record<ForgotMethod, string> = { usb: 'USB cable', seed: 'Admin seed password' };

/**
 * Erase the device after a forgotten password: explain what goes, then ask for proof of
 * ownership (the serial over the USB cable, or the admin's seed password) and ERASE.
 */
export function ForgotDialog({ onClose }: { onClose: () => void }) {
  const methods = useQuery({ queryKey: ['auth', 'forgot'], queryFn: api.auth.forgotMethods });
  const reset = useMutation({ mutationFn: api.auth.forgotReset });
  const [step, setStep] = useState<'explain' | 'confirm'>('explain');
  const [form, setForm] = useState<ForgotForm>({ method: 'usb', serial: '', seedPassword: '', confirm: '' });
  const fields = validationFields(reset.error);
  const choices = methods.data ? availableMethods(methods.data) : [];
  const method = choices.includes(form.method) ? form.method : (choices[0] ?? form.method);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const ready = { ...form, method };
    if (canErase(ready)) reset.mutate(toResetInput(ready));
  }

  if (reset.isSuccess) {
    return (
      <Dialog title="Erasing the device" onClose={() => window.location.reload()}>
        <div className={styles.form}>
          <p>The device is erasing everything and restarting. This takes about a minute.</p>
          <p>
            Then connect to it again (its hotspot or the USB cable) and open this page: it asks you to set the device up. A member must then be added to the
            network again by its Kaonic Admin.
          </p>
          <Button variant="primary" block onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Forgot the password?" onClose={onClose}>
      {methods.isPending ? (
        <Skeleton lines={4} />
      ) : methods.isError ? (
        <Notice tone="danger">{errorMessage(methods.error)}</Notice>
      ) : step === 'explain' ? (
        <div className={styles.form}>
          <p>The password can't be recovered. You can erase the device and set it up again. Erasing removes:</p>
          <ul className={styles.list}>
            <li>its identity, its certificate and its place in your network;</li>
            <li>its keys, including the push-to-talk group key;</li>
            <li>the password, all settings and the saved Wi-Fi networks.</li>
          </ul>
          <p className={styles.muted}>
            A member must then be added to the network again by its Kaonic Admin. On the admin device, nodes keep trusting the admin only if you set it up again with
            the same seed password.
          </p>
          {choices.length === 0 ? (
            <Notice tone="warn">
              {methods.data?.setUp === false
                ? 'This device is not set up yet: there is nothing to erase.'
                : 'From this connection the device can only be erased over its USB cable. Connect a computer to it by USB and open this page from there.'}
            </Notice>
          ) : null}
          <div className={styles.buttons}>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="danger" disabled={choices.length === 0} onClick={() => setStep('confirm')}>
              Continue
            </Button>
          </div>
        </div>
      ) : (
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          {choices.length > 1 ? (
            <Segmented label="How to prove you own the device" options={choices.map((value) => ({ value, label: METHOD_LABELS[value] }))} value={method} onChange={(value) => setForm({ ...form, method: value })} />
          ) : null}
          {method === 'usb' ? (
            <Field label="Serial number" hint="On the device's label." error={fields.serial}>
              {(control) => <Input {...control} autoFocus autoComplete="off" spellCheck={false} value={form.serial} onChange={(event) => setForm({ ...form, serial: event.target.value })} />}
            </Field>
          ) : (
            <Field label="Admin seed password" hint="The seed password set when this device was made the Kaonic Admin." error={fields.seedPassword}>
              {(control) => <Input {...control} type="password" autoFocus autoComplete="off" value={form.seedPassword} onChange={(event) => setForm({ ...form, seedPassword: event.target.value })} />}
            </Field>
          )}
          <Field label={`Type ${CONFIRM_WORD} to confirm`} error={fields.confirm}>
            {(control) => <Input {...control} autoComplete="off" spellCheck={false} value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} />}
          </Field>
          {reset.isError && !isApiError(reset.error, 'validation_failed') ? <Notice tone="danger">{errorMessage(reset.error)}</Notice> : null}
          <div className={styles.buttons}>
            <Button onClick={() => setStep('explain')}>Back</Button>
            <Button type="submit" variant="danger" busy={reset.isPending} disabled={!canErase({ ...form, method })}>
              Erase the device
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
