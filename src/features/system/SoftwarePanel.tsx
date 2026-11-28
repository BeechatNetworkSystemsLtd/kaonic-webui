import { useState, type DragEvent, type FormEvent } from 'react';
import { CircleAlert, FileArchive, RotateCw, Upload } from 'lucide-react';
import { api, errorMessage, validationFields, type HubUpdate, type PackageUpload } from '@/api';
import { useAuthState, useRestartService, useSoftware, useUpdateHub, useUpdateInstaller, useUpdateProgram } from '@/data/queries';
import { CoreIcon } from '@/features/plugins/CoreSoftware';
import { isDowngradeRefusal, formatWhen } from '@/features/plugins/software';
import { formatBytes } from '@/lib/format';
import { Button, Dialog, Field, Input, LoadError, Notice, Panel, Skeleton, Status, Switch } from '@/ui';
import wizard from './UpdateOs.module.css';
import styles from './SoftwarePanel.module.css';

type Kind = 'hub' | 'installer' | 'program';

/** A core program, as listed and updated here. */
interface Target {
  id: string;
  name: string;
  description: string;
  version: string | null;
  running: boolean;
  kind: Kind;
}

/** The core programs: one row each with its version, an update and a restart (admin only). */
export function SoftwarePanel() {
  /** The hub update started from this page, followed until it ends. */
  const [following, setFollowing] = useState<number | null>(null);
  const [updating, setUpdating] = useState<Target | null>(null);
  const software = useSoftware(following);
  const job = software.data?.hubUpdate ?? null;
  const hubBusy = job?.state === 'running' || (following !== null && job?.id !== following);

  const targets: Target[] = software.data
    ? [
        {
          id: 'kaonic-hub',
          name: 'Hub',
          description: 'Web UI, API, mesh, VPN, push-to-talk and plugins',
          version: software.data.hub.version,
          running: true,
          kind: 'hub',
        },
        {
          id: 'kaonic-hub-installer',
          name: 'Plugin installer',
          description: 'Installs, runs and updates plugins and the hub',
          version: software.data.installer.version,
          running: software.data.installer.reachable,
          kind: 'installer',
        },
        ...software.data.programs.map((program): Target => ({ ...program, kind: 'program' })),
      ]
    : [];

  return (
    <Panel title="Software">
      {software.isPending ? (
        <Skeleton lines={4} />
      ) : software.isError && !software.data ? (
        <LoadError error={software.error} onRetry={() => void software.refetch()} />
      ) : (
        <div className={styles.panel}>
          {software.data.releaseKey === false ? <Notice tone="warn">Development device: no release key. Updates and plugins install unsigned.</Notice> : null}
          <ul className={styles.list}>
            {targets.map((target) => (
              <SoftwareRow
                key={target.id}
                target={target}
                canUpdate={target.kind === 'hub' ? !hubBusy : target.kind === 'installer' ? target.running : true}
                onUpdate={() => setUpdating(target)}
              />
            ))}
          </ul>
          {job && job.id !== following ? <LastHubUpdate job={job} /> : null}
        </div>
      )}
      {updating ? (
        <UpdateDialog
          target={updating}
          job={job}
          onHubJob={setFollowing}
          onClose={() => {
            setUpdating(null);
            setFollowing(null);
          }}
        />
      ) : null}
    </Panel>
  );
}

function LastHubUpdate({ job }: { job: HubUpdate }) {
  const when = formatWhen(job.finished ?? job.started);
  if (job.state === 'running') return <Notice>Updating the hub to {job.version}. It restarts; this page reconnects when it is back.</Notice>;
  if (job.state === 'failed') return <Notice tone="danger">{`The hub update to ${job.version} failed (${when}): ${job.message || 'the old hub is back.'}`}</Notice>;
  return <p className={styles.muted}>Last hub update: {job.version}, {when}.</p>;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves once the hub answers again after restarting itself. */
async function hubBack(): Promise<void> {
  await pause(1500);
  for (;;) {
    try {
      await api.software.state();
      return;
    } catch {
      await pause(1000);
    }
  }
}

/** Icon, name, version and what it does, then update and restart. The row shows a loader while it restarts. */
function SoftwareRow({ target, canUpdate, onUpdate }: { target: Target; canUpdate: boolean; onUpdate: () => void }) {
  const restart = useRestartService();
  const [waiting, setWaiting] = useState(false);
  const busy = restart.isPending || waiting;

  function onRestart() {
    restart.mutate(`${target.id}.service`, {
      onSuccess: () => {
        // The hub answers first and restarts after: wait until it is back.
        if (target.kind !== 'hub') return;
        setWaiting(true);
        void hubBack().then(() => setWaiting(false));
      },
    });
  }

  return (
    <li className={styles.row} data-busy={busy || undefined} aria-busy={busy || undefined}>
      <span className={styles.icon}>
        <CoreIcon id={target.id} lit={target.running} size={36} />
      </span>
      <div className={styles.text}>
        <p className={styles.name}>{target.name}</p>
        <p className={styles.detail}>
          {busy ? (
            <span className={styles.restarting}>Restarting…</span>
          ) : target.running ? (
            <span className={`${styles.version} num`}>{target.version ?? '–'}</span>
          ) : (
            <Status tone="danger">Not running</Status>
          )}
          {target.description ? <span className={styles.description}>{target.description}</span> : null}
        </p>
        {restart.isError ? <p className={styles.error}>{errorMessage(restart.error)}</p> : null}
      </div>
      <Button iconOnly aria-label={`Update ${target.name}`} title={`Update ${target.name}`} disabled={!canUpdate || busy} onClick={onUpdate}>
        <Upload size={16} aria-hidden />
      </Button>
      <Button iconOnly aria-label={`Restart ${target.name}`} title={`Restart ${target.name}`} disabled={busy} onClick={onRestart}>
        <RotateCw size={16} aria-hidden />
      </Button>
    </li>
  );
}

type Step = 'choose' | 'ready' | 'uploading' | 'installing' | 'older' | 'failed' | 'done';

/** The update of one core program: choose a package, confirm, then watch it upload and go in. */
function UpdateDialog({ target, job, onHubJob, onClose }: { target: Target; job: HubUpdate | null; onHubJob: (id: number) => void; onClose: () => void }) {
  const updateHub = useUpdateHub();
  const updateInstaller = useUpdateInstaller();
  const updateProgram = useUpdateProgram(target.id);
  const [base, setStep] = useState<Step>('choose');
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(0);
  const [error, setFailure] = useState<string | null>(null);
  const [result, setVersion] = useState<string | null>(null);
  const [hubJob, setHubJob] = useState<number | null>(null);
  const hub = target.kind === 'hub';

  // The hub update goes on after the answer: its job says how it ended.
  const ended = base === 'installing' && hubJob !== null && job?.id === hubJob && job.state !== 'running' ? job : null;
  const step: Step = ended ? (ended.state === 'done' ? 'done' : 'failed') : base;
  const failure = ended?.state === 'failed' ? ended.message || 'The new hub did not come up; the old one is back.' : error;
  const version = ended?.state === 'done' ? ended.version : result;
  const stages = ['Upload', hub ? 'Restart' : 'Install', 'Done'];
  const stage = step === 'choose' || step === 'ready' || step === 'uploading' ? 0 : step === 'done' ? 2 : 1;

  function send(allowDowngrade: boolean) {
    if (!file) return;
    const upload: PackageUpload = { password, allowDowngrade };
    const onProgress = (fraction: number) => {
      setSent(fraction);
      if (fraction >= 1) setStep('installing');
    };
    const onError = (error: unknown) => {
      if (isDowngradeRefusal(error)) {
        setStep('older');
        return;
      }
      const fields = validationFields(error);
      if (fields.password) {
        setFailure(fields.password);
        setStep('ready');
        return;
      }
      setFailure(errorMessage(error));
      setStep('failed');
    };
    setFailure(null);
    setSent(0);
    setStep('uploading');
    if (hub) {
      updateHub.mutate(
        { file, upload, onProgress },
        {
          onSuccess: (started) => {
            setHubJob(started.id);
            onHubJob(started.id);
            setStep('installing');
          },
          onError,
        },
      );
      return;
    }
    const mutation = target.kind === 'installer' ? updateInstaller : updateProgram;
    mutation.mutate(
      { file, upload, onProgress },
      {
        onSuccess: (result) => {
          setVersion(result.version || null);
          setStep('done');
        },
        onError,
      },
    );
  }

  const working = step === 'uploading' || step === 'installing';

  return (
    <Dialog title={`Update ${target.name}`} onClose={() => (working ? undefined : onClose())}>
      <ol className={wizard.stepper} aria-label="Steps">
        {stages.map((name, index) => (
          <li
            key={name}
            className={wizard.stage}
            data-state={index < stage ? 'done' : index === stage ? (step === 'failed' ? 'failed' : step === 'done' ? 'done' : 'active') : 'todo'}
          >
            <span className={wizard.stageDot} aria-hidden />
            <span className={wizard.stageName}>{name}</span>
          </li>
        ))}
      </ol>
      {/* Keyed by step, so each step slides in. */}
      <div key={step} className={wizard.step}>
        {step === 'choose' ? (
          <Choose
            target={target}
            onFile={(chosen) => {
              setFile(chosen);
              setStep('ready');
            }}
          />
        ) : null}
        {step === 'ready' && file ? (
          <Ready target={target} file={file} password={password} setPassword={setPassword} failure={failure} onSend={() => send(false)} onBack={() => setStep('choose')} />
        ) : null}
        {step === 'uploading' ? (
          <Progress
            title="Uploading"
            value={sent}
            text={file ? `${formatBytes(sent * file.size)} of ${formatBytes(file.size)}` : ''}
            note="Keep this page open until the upload is done."
          />
        ) : null}
        {step === 'installing' && hub ? (
          <div className={wizard.result}>
            <div className={wizard.pulse} aria-hidden />
            <p className={wizard.resultTitle}>Restarting the hub</p>
            <p className={wizard.resultText}>
              The device checked the package and starts the new hub. If it does not come up within two minutes, the old one comes back. This page reconnects by itself.
            </p>
          </div>
        ) : null}
        {step === 'installing' && !hub ? (
          <div className={wizard.progress}>
            <div className={wizard.progressHead}>
              <span className={wizard.progressTitle}>Installing</span>
            </div>
            <div className={wizard.track} role="progressbar" aria-label="Installing">
              <div className={styles.indeterminate} />
            </div>
            <p className={wizard.note}>
              {target.kind === 'installer'
                ? 'The hub restarts the plugin installer with the package and waits for it, up to two minutes. Plugins keep running.'
                : `The hub restarts ${target.name} with the package and waits until it runs it, up to two minutes. If the new one does not stay up, the old one comes back.`}
            </p>
          </div>
        ) : null}
        {step === 'older' ? <Older onInstall={() => send(true)} onCancel={onClose} /> : null}
        {step === 'failed' ? (
          <div className={wizard.result}>
            <div className={wizard.failIcon} aria-hidden>
              <CircleAlert />
            </div>
            <p className={wizard.resultTitle}>The update did not go in</p>
            <p className={wizard.resultText}>{failure ?? 'The package was refused.'}</p>
            <div className={wizard.actions}>
              <Button
                variant="primary"
                onClick={() => {
                  setFile(null);
                  setStep('choose');
                }}
              >
                Choose another file
              </Button>
              <Button onClick={onClose}>Close</Button>
            </div>
          </div>
        ) : null}
        {step === 'done' ? (
          <div className={wizard.result}>
            <Check />
            <p className={wizard.resultTitle}>
              {target.name} is updated{version ? ` to ${version}` : ''}
            </p>
            <p className={wizard.resultText}>{hub ? 'The new hub is running.' : 'It runs the new version now.'}</p>
            <div className={wizard.actions}>
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function Choose({ target, onFile }: { target: Target; onFile: (file: File) => void }) {
  const [over, setOver] = useState(false);
  function onDrop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  }
  return (
    <>
      <label
        className={wizard.drop}
        data-over={over || undefined}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <FileArchive className={wizard.dropIcon} aria-hidden />
        <span className={wizard.dropTitle}>Drop the package here, or choose it</span>
        <span className={wizard.dropHint}>
          The <span className="mono">{target.id}-….kpkg</span> file
        </span>
        <input
          type="file"
          className={wizard.fileInput}
          accept=".kpkg,.tar,application/x-tar"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onFile(file);
          }}
        />
      </label>
      <p className={wizard.note}>If the new version does not start, the old one comes back by itself.</p>
    </>
  );
}

interface ReadyProps {
  target: Target;
  file: File;
  password: string;
  setPassword: (password: string) => void;
  failure: string | null;
  onSend: () => void;
  onBack: () => void;
}

function Ready({ target, file, password, setPassword, failure, onSend, onBack }: ReadyProps) {
  const needsPassword = useAuthState().data?.passwordSet ?? true;
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    onSend();
  }
  return (
    <form className={wizard.ready} onSubmit={onSubmit}>
      <div className={wizard.compare}>
        <div className={wizard.compareSide}>
          <span className={wizard.compareLabel}>Now</span>
          <span className={wizard.compareVersion}>{target.version ?? '–'}</span>
        </div>
        <span className={wizard.arrow} aria-hidden>
          →
        </span>
        <div className={wizard.compareSide}>
          <span className={wizard.compareLabel}>Package</span>
          <span className={`${wizard.compareVersion} ${styles.fileName}`} title={file.name}>
            {file.name}
          </span>
        </div>
      </div>
      <p className={`${wizard.note} num`}>{formatBytes(file.size)}</p>
      {needsPassword ? (
        <Field label="Enter the password to update" error={failure ?? undefined}>
          {(control) => <Input {...control} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />}
        </Field>
      ) : failure ? (
        <p className={wizard.error} role="alert">
          {failure}
        </p>
      ) : null}
      <div className={wizard.actions}>
        <Button type="submit" variant="primary" disabled={needsPassword && !password}>
          Update
        </Button>
        <Button onClick={onBack}>Choose another file</Button>
      </div>
    </form>
  );
}

function Older({ onInstall, onCancel }: { onInstall: () => void; onCancel: () => void }) {
  const [allow, setAllow] = useState(false);
  return (
    <div className={wizard.ready}>
      <Notice tone="warn">This package is older than a version installed before. Allow the downgrade to install it.</Notice>
      <div className={styles.toggle}>
        <Switch checked={allow} onChange={setAllow} label="Allow installing an older version" />
        <span>Allow installing an older version</span>
      </div>
      <div className={wizard.actions}>
        <Button variant="primary" disabled={!allow} onClick={onInstall}>
          Install the older version
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function Progress({ title, value, text, note }: { title: string; value: number; text: string; note: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={wizard.progress}>
      <div className={wizard.progressHead}>
        <span className={wizard.progressTitle}>{title}</span>
        <span className="num">{percent}%</span>
      </div>
      <div className={wizard.track} role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className={wizard.fill} style={{ width: `${percent}%` }} />
      </div>
      {text ? <p className={`${wizard.note} num`}>{text}</p> : null}
      <p className={wizard.note}>{note}</p>
    </div>
  );
}

function Check() {
  return (
    <svg className={wizard.check} viewBox="0 0 52 52" aria-hidden>
      <circle className={wizard.checkCircle} cx="26" cy="26" r="24" />
      <path className={wizard.checkMark} d="M15 27l7 7 15-15" />
    </svg>
  );
}
