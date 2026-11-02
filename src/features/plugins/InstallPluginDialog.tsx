import { useId, useState, type DragEvent, type FormEvent } from 'react';
import { PackagePlus } from 'lucide-react';
import { validationFields, type PluginInstallResult } from '@/api';
import { useInstallPlugin } from '@/data/queries';
import { formatBytes } from '@/lib/format';
import { Button, Dialog, Field, FormError, Input, Notice } from '@/ui';
import styles from './InstallPluginDialog.module.css';

interface InstallPluginDialogProps {
  onClose: () => void;
  onInstalled: (result: PluginInstallResult) => void;
}

/** Picks a plugin package (by drop or by browsing) and sends it to the hub with the password. A package of a plugin already installed updates it. */
export function InstallPluginDialog({ onClose, onInstalled }: InstallPluginDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [password, setPassword] = useState('');
  const install = useInstallPlugin();
  const helpId = useId();
  const fields = validationFields(install.error);

  function choose(next: File | null) {
    setFile(next);
    install.reset();
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!install.isPending) choose(event.dataTransfer.files[0] ?? null);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (file) install.mutate({ file, password }, { onSuccess: onInstalled });
  }

  return (
    <Dialog title="Install plugin" onClose={onClose}>
      <form className={styles.form} onSubmit={onSubmit}>
        <label
          className={styles.drop}
          data-dragging={dragging}
          data-chosen={file !== null}
          data-invalid={fields.file !== undefined}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            className="visually-hidden"
            type="file"
            accept=".zip,application/zip"
            disabled={install.isPending}
            aria-describedby={helpId}
            onChange={(event) => choose(event.target.files?.[0] ?? null)}
          />
          <PackagePlus className={styles.icon} aria-hidden />
          {file ? (
            <>
              <span className={styles.fileName}>{file.name}</span>
              <span className={`${styles.fileMeta} num`}>{formatBytes(file.size)}, click to choose another</span>
            </>
          ) : (
            <>
              <span className={styles.prompt}>Drop a plugin package here</span>
              <span className={styles.fileMeta}>or click to browse for its .zip file</span>
            </>
          )}
        </label>
        {fields.file ? (
          <p className={styles.error} role="alert">
            {fields.file}
          </p>
        ) : null}

        <p id={helpId} className="muted">
          Installing a newer package of a plugin you already have updates it and keeps its settings. A new plugin stays off until you turn it on.
        </p>
        <Notice tone="warn">
          A plugin runs with full control of this device. Packages are not signed yet, so every plugin installs as an unsigned plugin: install only packages you got from Beechat or a developer you trust.
        </Notice>

        <Field label="Enter the password to confirm" error={fields.password}>
          {(control) => (
            <Input {...control} type="password" autoComplete="current-password" required disabled={install.isPending} value={password} onChange={(event) => setPassword(event.target.value)} />
          )}
        </Field>

        <FormError error={install.error} />

        <div className={styles.actions}>
          <Button type="submit" variant="primary" busy={install.isPending} disabled={!file || !password}>
            {install.isPending ? 'Installing' : 'Install plugin'}
          </Button>
          <Button onClick={onClose} disabled={install.isPending}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
