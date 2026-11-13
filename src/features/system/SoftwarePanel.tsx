import { useState, type ChangeEvent, type FormEvent } from 'react';
import { validationFields, type HubUpdate, type PackageUpload } from '@/api';
import { useSoftware, useUpdateHub, useUpdateInstaller } from '@/data/queries';
import { CoreIcon } from '@/features/plugins/CoreSoftware';
import { isDowngradeRefusal, formatWhen } from '@/features/plugins/software';
import { formatBytes } from '@/lib/format';
import { Button, Field, FormError, Input, KeyValues, LoadError, Notice, Panel, Skeleton, Status, Switch } from '@/ui';
import styles from './SystemPage.module.css';

/** The hub and the plugin installer: their versions, and updating each (admin only). */
export function SoftwarePanel() {
  /** The hub update started from this page, followed until it ends. */
  const [following, setFollowing] = useState<number | null>(null);
  const software = useSoftware(following);
  const updateHub = useUpdateHub();
  const updateInstaller = useUpdateInstaller();
  const job = software.data?.hubUpdate ?? null;
  const running = job?.state === 'running' || (following !== null && job?.id !== following);

  return (
    <Panel title="Software">
      {software.isPending ? (
        <Skeleton lines={4} />
      ) : software.isError && !software.data ? (
        <LoadError error={software.error} onRetry={() => void software.refetch()} />
      ) : (
        <div className={styles.maintenance}>
          {software.data.releaseKey === false ? <Notice tone="warn">Development device: no release key. Updates and plugins install unsigned.</Notice> : null}
          <KeyValues
            rows={[
              ['Hub', <><CoreIcon id="kaonic-hub" lit size={20} /> {software.data.hub.version} <span className={styles.unit}>{software.data.hub.fromUpdate ? '(updated copy)' : '(from the system image)'}</span></>],
              [
                'Plugin installer',
                <>
                  <CoreIcon id="kaonic-hub-installer" lit={software.data.installer.reachable} size={20} />{' '}
                  {software.data.installer.reachable ? software.data.installer.version ?? '–' : <Status tone="danger">Not running</Status>}
                </>,
              ],
            ]}
          />
          {job ? <HubUpdateState job={job} following={job.id === following} /> : following !== null ? <Notice>The hub is restarting. This page reconnects when it is back.</Notice> : null}
          <PackageAction
            title="Update hub"
            text="The device checks the package, then restarts the hub with it. If the new hub does not come up within two minutes, the old one comes back."
            busyText="Checking"
            send={updateHub}
            done={(started) => setFollowing(started.id)}
            disabled={running}
          />
          <PackageAction
            title="Update installer"
            text="The hub restarts the plugin installer with the package and waits for it, up to two minutes. Plugins keep running."
            busyText="Updating, up to two minutes"
            send={updateInstaller}
            result={(updated) => `The installer is updated${updated.version ? ` to ${updated.version}` : ''}.`}
            disabled={!software.data.installer.reachable}
          />
        </div>
      )}
    </Panel>
  );
}

function HubUpdateState({ job, following }: { job: HubUpdate; following: boolean }) {
  if (job.state === 'running') {
    return <Notice>Updating the hub to {job.version}. It restarts; this page reconnects when it is back.</Notice>;
  }
  const when = formatWhen(job.finished ?? job.started);
  if (job.state === 'failed') {
    return <Notice tone="danger">{`The hub update to ${job.version} failed${following ? '' : ` (${when})`}: ${job.message || 'the old hub is back.'}`}</Notice>;
  }
  return following ? <Notice>The hub is updated to {job.version}.</Notice> : <p className={styles.unit}>Last hub update: {job.version}, {when}.</p>;
}

interface PackageMutation<R> {
  mutate: (variables: { file: File; upload: PackageUpload }, options: { onSuccess: (result: R) => void; onError: (error: unknown) => void }) => void;
  reset: () => void;
  isPending: boolean;
  error: unknown;
  data: R | undefined;
}

interface PackageActionProps<R> {
  title: string;
  text: string;
  busyText: string;
  send: PackageMutation<R>;
  /** Called when the device took the package. */
  done?: (result: R) => void;
  /** What to say once it is done. */
  result?: (result: R) => string;
  disabled?: boolean;
}

/** A package upload with the password again; offers the downgrade when the device refuses an older version. */
function PackageAction<R>({ title, text, busyText, send, done, result, disabled }: PackageActionProps<R>) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [downgradeOffered, setDowngradeOffered] = useState(false);
  const [allowDowngrade, setAllowDowngrade] = useState(false);
  const fields = validationFields(send.error);

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    event.target.value = '';
    setDowngradeOffered(false);
    setAllowDowngrade(false);
    send.reset();
  }

  function close() {
    setOpen(false);
    setFile(null);
    setPassword('');
    setDowngradeOffered(false);
    setAllowDowngrade(false);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    send.mutate(
      { file, upload: { password, allowDowngrade } },
      {
        onSuccess: (answer) => {
          close();
          done?.(answer);
        },
        onError: (error) => {
          if (isDowngradeRefusal(error)) setDowngradeOffered(true);
        },
      },
    );
  }

  return (
    <div className={styles.bootBlock}>
      <div className={styles.action}>
        <div>
          <p className={styles.serviceName}>{title}</p>
          <p className={styles.unit}>{text}</p>
        </div>
        {!open ? (
          <Button
            disabled={disabled}
            onClick={() => {
              send.reset();
              setOpen(true);
            }}
          >
            {title}…
          </Button>
        ) : null}
      </div>
      {!open && result && send.data !== undefined ? <Notice>{result(send.data)}</Notice> : null}
      {open ? (
        <form className={styles.confirm} onSubmit={onSubmit}>
          <div className={styles.confirmActions}>
            <label className={styles.fileButton}>
              Choose package…
              <input type="file" className={styles.fileInput} accept=".kpkg,.tar,application/x-tar" disabled={send.isPending} onChange={onFile} />
            </label>
          </div>
          {file ? (
            <p className={styles.unit}>
              {file.name}, <span className="num">{formatBytes(file.size)}</span>
            </p>
          ) : null}
          {fields.file ? <Notice tone="danger">{fields.file}</Notice> : null}
          <Field label="Enter the password to confirm" error={fields.password}>
            {(control) => (
              <Input {...control} type="password" autoComplete="current-password" required disabled={send.isPending} value={password} onChange={(event) => setPassword(event.target.value)} />
            )}
          </Field>
          {downgradeOffered ? (
            <>
              <Notice tone="warn">This package is older than a version installed before. Allow the downgrade to install it.</Notice>
              <div className={styles.toggle}>
                <Switch checked={allowDowngrade} onChange={setAllowDowngrade} label="Allow installing an older version" disabled={send.isPending} />
                <span>Allow installing an older version</span>
              </div>
            </>
          ) : null}
          {isDowngradeRefusal(send.error) ? null : <FormError error={send.error} />}
          <div className={styles.confirmActions}>
            <Button type="submit" variant="primary" busy={send.isPending} disabled={!file || !password || (downgradeOffered && !allowDowngrade)}>
              {send.isPending ? busyText : title}
            </Button>
            <Button disabled={send.isPending} onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
