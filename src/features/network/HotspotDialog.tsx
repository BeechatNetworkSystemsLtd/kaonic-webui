import { useState, type FormEvent } from 'react';
import { validationFields, type Hotspot } from '@/api';
import { useSetHotspot, useWifi } from '@/data/queries';
import { Button, Dialog, Field, FormError, Input, LoadError, Notice, Skeleton } from '@/ui';
import styles from './Wifi.module.css';

/** The settings for access point (AP) mode: the network this device broadcasts. */
export function HotspotDialog({ onClose }: { onClose: () => void }) {
  const wifi = useWifi();
  return (
    <Dialog title="Hotspot" onClose={onClose}>
      {wifi.isPending ? (
        <Skeleton lines={3} />
      ) : wifi.isError ? (
        <LoadError error={wifi.error} onRetry={() => void wifi.refetch()} />
      ) : (
        <HotspotForm saved={wifi.data.hotspot} onClose={onClose} />
      )}
    </Dialog>
  );
}

function HotspotForm({ saved, onClose }: { saved: Hotspot; onClose: () => void }) {
  const [ssid, setSsid] = useState(saved.ssid);
  const [password, setPassword] = useState(saved.password ?? '');
  const [open, setOpen] = useState(saved.open);
  const [reveal, setReveal] = useState(false);
  const save = useSetHotspot();
  const fields = validationFields(save.error);
  const dirty = ssid !== saved.ssid || open !== saved.open || (!open && password !== (saved.password ?? ''));

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate({ ssid, password: open ? null : password }, { onSuccess: onClose });
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      {saved.open ? (
        <Notice tone="warn">The hotspot has no password: anyone in range can join it and reach this device's sign-in page. Set a password.</Notice>
      ) : null}
      <Field label="Network name" hint="What phones and laptops see in their Wi-Fi list." error={fields.ssid}>
        {(control) => <Input {...control} maxLength={32} autoCapitalize="none" autoCorrect="off" spellCheck={false} value={ssid} onChange={(event) => setSsid(event.target.value)} />}
      </Field>
      {open ? null : (
        <Field label="Password" hint="8 to 63 characters." error={fields.password}>
          {(control) => (
            <div className={styles.withButton}>
              <Input {...control} className="mono" type={reveal ? 'text' : 'password'} autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} />
              <Button onClick={() => setReveal(!reveal)} aria-pressed={reveal}>
                {reveal ? 'Hide' : 'Show'}
              </Button>
            </div>
          )}
        </Field>
      )}
      <label className="muted">
        <input type="checkbox" checked={open} onChange={(event) => setOpen(event.target.checked)} /> No password (open hotspot, not recommended)
      </label>
      {dirty ? <Notice tone="warn">Devices on the hotspot are disconnected when you save, and must join again with the new details.</Notice> : null}
      <FormError error={save.error} />
      <div className={styles.formActions}>
        <Button type="submit" variant="primary" busy={save.isPending} disabled={!dirty}>
          Save hotspot
        </Button>
        <Button onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
