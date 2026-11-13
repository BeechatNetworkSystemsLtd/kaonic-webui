import { useId, useState, type DragEvent, type FormEvent } from 'react';
import { PackagePlus } from 'lucide-react';
import { validationFields, type Plugin, type PluginInstallResult, type PluginPackageInfo } from '@/api';
import { useCheckPluginPackage, useInstallPlugin, usePluginPolicy, useUpdatePlugin } from '@/data/queries';
import { formatBytes } from '@/lib/format';
import { Badge, Button, Dialog, Field, FormError, Input, Notice, Switch } from '@/ui';
import { compareVersions, isDowngradeRefusal, PERMISSIONS } from './software';
import styles from './InstallPluginDialog.module.css';

interface InstallPluginDialogProps {
  /** Update this plugin only; without it, any package installs or updates its plugin. */
  plugin?: Plugin;
  onClose: () => void;
  onInstalled: (result: PluginInstallResult) => void;
}

/**
 * Picks a plugin package (by drop or by browsing), shows what the device reads from it
 * (what it is, whether it is signed, what it asks for), then sends it with the password.
 * A package of a plugin already installed updates it. An older version than one
 * installed before is refused until the admin allows the downgrade.
 */
export function InstallPluginDialog({ plugin, onClose, onInstalled }: InstallPluginDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [password, setPassword] = useState('');
  /** Offered for an older version, or once the device refused one; stays until another file is chosen. */
  const [downgradeOffered, setDowngradeOffered] = useState(false);
  const [allowDowngrade, setAllowDowngrade] = useState(false);
  const check = useCheckPluginPackage();
  const install = useInstallPlugin();
  const update = useUpdatePlugin();
  const sending = plugin ? update : install;
  const policy = usePluginPolicy();
  const helpId = useId();
  const fields = { ...validationFields(check.error), ...validationFields(sending.error) };
  const info = check.data;
  const busy = check.isPending || sending.isPending;

  /** Why this package cannot go in here, before trying. */
  const blocked = !info
    ? null
    : plugin && info.id !== plugin.id
      ? `This package is ${info.name} (${info.id}), not ${plugin.name}.`
      : policy.data?.requireSigned && !info.signed
        ? 'This package is not signed, and this device installs only plugins signed by Beechat.'
        : null;

  function choose(next: File | null) {
    setFile(next);
    setDowngradeOffered(false);
    setAllowDowngrade(false);
    install.reset();
    update.reset();
    check.reset();
    if (!next) return;
    check.mutate(next, {
      onSuccess: (read) => {
        if (read.installed && compareVersions(read.version, read.installed) < 0) setDowngradeOffered(true);
      },
    });
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!busy) choose(event.dataTransfer.files[0] ?? null);
  }

  function onError(error: unknown) {
    if (isDowngradeRefusal(error)) setDowngradeOffered(true);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file || !info || blocked) return;
    const upload = { password, allowDowngrade };
    if (plugin) update.mutate({ id: plugin.id, file, upload }, { onSuccess: (updated) => onInstalled({ action: 'updated', plugin: updated }), onError });
    else install.mutate({ file, upload }, { onSuccess: onInstalled, onError });
  }

  return (
    <Dialog title={plugin ? `Update ${plugin.name}` : 'Install plugin'} onClose={onClose}>
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
            accept=".kpkg,.tar,application/x-tar"
            disabled={busy}
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
              <span className={styles.fileMeta}>or click to browse for its .kpkg file</span>
            </>
          )}
        </label>
        {fields.file ? (
          <p className={styles.error} role="alert">
            {fields.file}
          </p>
        ) : null}

        {!file ? (
          <p id={helpId} className="muted">
            {plugin
              ? `Version ${plugin.version} is installed. Its data is kept, and you can roll back to ${plugin.version} after the update.`
              : 'A package of a plugin you already have updates it and keeps its data. The device starts the plugin and puts the old version back if it does not keep running.'}
          </p>
        ) : check.isPending ? (
          <p id={helpId} className="muted">
            Reading the package…
          </p>
        ) : check.isError ? (
          fields.file ? null : <FormError error={check.error} />
        ) : info ? (
          <PackageSummary info={info} />
        ) : null}

        {blocked ? <Notice tone="danger">{blocked}</Notice> : null}

        {info && !blocked ? (
          <>
            {!info.signed ? <Notice tone="warn">This plugin is not signed, so Beechat has not checked it. Install it only if you trust its developer.</Notice> : null}

            {downgradeOffered ? (
              <>
                <Notice tone="warn">This package is older than a version installed before. Allow the downgrade to install it.</Notice>
                <div className={styles.toggle}>
                  <Switch checked={allowDowngrade} onChange={setAllowDowngrade} label="Allow installing an older version" disabled={sending.isPending} />
                  <span>Allow installing an older version</span>
                </div>
              </>
            ) : null}

            <Field label="Enter the password to confirm" error={fields.password}>
              {(control) => (
                <Input
                  {...control}
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={sending.isPending}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              )}
            </Field>
          </>
        ) : null}

        {isDowngradeRefusal(sending.error) ? null : <FormError error={sending.error} />}

        <div className={styles.actions}>
          <Button
            type="submit"
            variant="primary"
            busy={sending.isPending}
            disabled={!info || blocked !== null || !password || (downgradeOffered && !allowDowngrade)}
          >
            {sending.isPending ? (plugin ? 'Updating' : 'Installing') : plugin ? 'Update plugin' : 'Install plugin'}
          </Button>
          <Button onClick={onClose} disabled={sending.isPending}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** What the package is, its version against the one installed, and what it may use. */
function PackageSummary({ info }: { info: PluginPackageInfo }) {
  const change = info.installed
    ? info.installed === info.version
      ? `version ${info.version}, the same as installed`
      : `version ${info.installed} → ${info.version}`
    : `version ${info.version}, new`;
  return (
    <section className={styles.summary} aria-label="What the package is">
      <h3 className={styles.summaryName}>
        {info.name}
        {info.signed ? <Badge tone="accent">Official</Badge> : <Badge tone="warn">Unsigned</Badge>}
      </h3>
      <p className={styles.fileMeta}>
        By {info.developer}, <span className="num">{change}</span>
        {info.hasPage ? ', with its own page' : ''}
      </p>
      {info.description ? <p className={styles.fileMeta}>{info.description}</p> : null}
      {info.permissions.length > 0 ? (
        <>
          <p className={styles.asks}>What it may use:</p>
          <ul className={styles.permissions}>
            {info.permissions.map((permission) => (
              <li key={permission} data-permission={permission}>
                <strong>{PERMISSIONS[permission].label}</strong> {PERMISSIONS[permission].explain}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={styles.asks}>It asks for no extra rights.</p>
      )}
    </section>
  );
}
