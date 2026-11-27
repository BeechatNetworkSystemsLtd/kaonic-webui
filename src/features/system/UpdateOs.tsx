import { useEffect, useState, type DragEvent, type FormEvent } from 'react';
import { CircleAlert, FileArchive, UploadCloud } from 'lucide-react';
import { api, errorMessage, validationFields, type OsState } from '@/api';
import { useAuthState, useDiscardOs, useInstallOs, useOs, useOsJob, useReboot, useUploadOs } from '@/data/queries';
import { formatBytes } from '@/lib/format';
import { Badge, Button, Dialog, Field, FormError, Input, KeyValues, LoadError, Panel, Skeleton } from '@/ui';
import styles from './UpdateOs.module.css';

type Step = 'choose' | 'uploading' | 'checking' | 'invalid' | 'ready' | 'installing' | 'done' | 'restarting' | 'back';

const STAGES = ['Upload', 'Check', 'Install', 'Restart'] as const;

/** The stage a step belongs to, for the stepper. */
function stageOf(step: Step): number {
  if (step === 'choose' || step === 'uploading') return 0;
  if (step === 'checking' || step === 'invalid' || step === 'ready') return 1;
  if (step === 'installing') return 2;
  return 3;
}

/** Where a reopened wizard picks up, from what the device says. */
function resume(os: OsState | undefined): Step {
  switch (os?.update?.state) {
    case 'checking':
      return 'checking';
    case 'ready':
      return 'ready';
    case 'invalid':
      return 'invalid';
    case 'installing':
      return 'installing';
    case 'installed':
      return 'done';
    default:
      return 'choose';
  }
}

/** The running system image, with the button that opens the update wizard. */
export function OsPanel({ admin }: { admin: boolean }) {
  const os = useOs();
  const [open, setOpen] = useState(false);
  const pending = os.data?.update?.state === 'installed';
  return (
    <Panel
      title="Operating system"
      actions={
        admin && os.data ? (
          <Button size="small" variant="primary" onClick={() => setOpen(true)}>
            <UploadCloud aria-hidden /> Update OS
          </Button>
        ) : null
      }
    >
      {os.isPending ? (
        <Skeleton lines={2} />
      ) : os.isError ? (
        <LoadError error={os.error} onRetry={() => void os.refetch()} />
      ) : (
        <div className={styles.summary}>
          <KeyValues
            rows={[
              ['Kaonic OS', pending ? <span>{os.data.version ?? '–'} <Badge tone="accent">{os.data.update?.version} after restart</Badge></span> : (os.data.version ?? '–')],
              ['Base system', os.data.os],
              ['Machine', <span className="mono">{os.data.machine ?? '–'}</span>],
              ['Running slot', os.data.slot ? os.data.slot.toUpperCase() : '–'],
            ]}
          />
        </div>
      )}
      {open && os.data ? <UpdateWizard initial={os.data} onClose={() => setOpen(false)} /> : null}
    </Panel>
  );
}

function UpdateWizard({ initial, onClose }: { initial: OsState; onClose: () => void }) {
  const os = useOs();
  const state = os.data ?? initial;
  const [base, setStep] = useState<Step>(() => resume(initial));
  const [file, setFile] = useState<File | null>(null);
  const [sent, setSent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(initial.update?.jobId ?? null);
  const job = useOsJob(jobId);
  const upload = useUploadOs();
  const discard = useDiscardOs();
  // A finished check or install moves the wizard on.
  const ended = job.data && (job.data.state === 'done' || job.data.state === 'failed') ? job.data : null;
  let step = base;
  let failure = error;
  if (ended && base === 'checking') {
    step = ended.state === 'done' ? 'ready' : 'invalid';
    failure = ended.error ?? failure;
  }
  if (ended && base === 'installing') {
    step = ended.state === 'done' ? 'done' : 'ready';
    failure = ended.error ?? failure;
  }
  const working = step === 'uploading' || step === 'installing' || step === 'restarting';

  function start(chosen: File) {
    setFile(chosen);
    setError(null);
    setSent(0);
    setStep('uploading');
    upload.mutate(
      { file: chosen, onProgress: setSent },
      {
        onSuccess: (started) => {
          setJobId(started.id);
          setStep('checking');
        },
        onError: (failure) => {
          setError(errorMessage(failure));
          setStep('invalid');
        },
      },
    );
  }

  function again() {
    discard.mutate();
    setError(null);
    setFile(null);
    setJobId(null);
    setStep('choose');
  }

  const checkError = failure ?? state.update?.error ?? null;
  const stage = stageOf(step);

  return (
    <Dialog title="Update OS" onClose={() => (working ? undefined : onClose())}>
      <ol className={styles.stepper} aria-label="Steps">
        {STAGES.map((name, index) => (
          <li key={name} className={styles.stage} data-state={index < stage || step === 'back' ? 'done' : index === stage ? (step === 'invalid' ? 'failed' : 'active') : 'todo'}>
            <span className={styles.stageDot} aria-hidden />
            <span className={styles.stageName}>{name}</span>
          </li>
        ))}
      </ol>
      {/* Keyed by step, so each step slides in. */}
      <div key={step} className={styles.step}>
        {step === 'choose' ? <Choose machine={state.machine} onFile={start} /> : null}
        {step === 'uploading' ? (
          <Progress
            title="Uploading"
            value={sent}
            text={file ? `${formatBytes(sent * file.size)} of ${formatBytes(file.size)}` : ''}
            note="Keep this page open until the upload is done."
          />
        ) : null}
        {step === 'checking' ? (
          <Progress title="Checking the image" value={job.data?.progress ?? 0} note="Every file is checked against the image's manifest and this device's model." />
        ) : null}
        {step === 'invalid' ? (
          <div className={styles.result}>
            <div className={styles.failIcon} aria-hidden>
              <CircleAlert />
            </div>
            <p className={styles.resultTitle}>This image cannot be installed</p>
            <p className={styles.resultText}>{checkError ?? 'The image was refused.'}</p>
            <div className={styles.actions}>
              <Button variant="primary" onClick={again}>Choose another file</Button>
              <Button onClick={onClose}>Close</Button>
            </div>
          </div>
        ) : null}
        {step === 'ready' ? (
          <Ready
            state={state}
            failure={failure}
            onInstall={(started) => {
              setError(null);
              setJobId(started);
              setStep('installing');
            }}
            onCancel={() => {
              discard.mutate();
              onClose();
            }}
          />
        ) : null}
        {step === 'installing' ? (
          <Progress
            title={job.data?.detail ?? 'Installing'}
            value={job.data?.progress ?? 0}
            note={`The update goes into slot ${(state.update?.slot ?? 'b').toUpperCase()}. The running system is not changed, and keeps working meanwhile.`}
          />
        ) : null}
        {step === 'done' ? <Done version={state.update?.version ?? null} onRestarting={() => setStep('restarting')} onLater={onClose} /> : null}
        {step === 'restarting' ? <Restarting expected={state.update?.version ?? null} onBack={() => setStep('back')} /> : null}
        {step === 'back' ? (
          <div className={styles.result}>
            <Check />
            <p className={styles.resultTitle}>The device is back</p>
            <p className={styles.resultText}>It now runs Kaonic OS {os.data?.version ?? state.update?.version ?? ''}.</p>
            <div className={styles.actions}>
              <Button variant="primary" onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function Choose({ machine, onFile }: { machine: string | null; onFile: (file: File) => void }) {
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
        className={styles.drop}
        data-over={over || undefined}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <FileArchive className={styles.dropIcon} aria-hidden />
        <span className={styles.dropTitle}>Drop the image here, or choose it</span>
        <span className={styles.dropHint} title={machine ?? undefined}>
          The <span className="mono">…-emmc.tar.gz</span> file made for {machine ? <span className="mono">{machine.replace(/^stm32mp1-/, '')}</span> : 'this device'}
        </span>
        <input
          type="file"
          className={styles.fileInput}
          accept=".gz,.tgz,application/gzip"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onFile(file);
          }}
        />
      </label>
      <p className={styles.note}>Settings, keys and plugins are kept. If the new system does not start, the device goes back to this one by itself.</p>
    </>
  );
}

function Progress({ title, value, text, note }: { title: string; value: number; text?: string; note: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={styles.progress}>
      <div className={styles.progressHead}>
        <span className={styles.progressTitle}>{title}</span>
        <span className="num">{percent}%</span>
      </div>
      <div className={styles.track} role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className={styles.fill} style={{ width: `${percent}%` }} />
      </div>
      {text ? <p className={`${styles.note} num`}>{text}</p> : null}
      <p className={styles.note}>{note}</p>
    </div>
  );
}

function Ready({ state, failure, onInstall, onCancel }: { state: OsState; failure: string | null; onInstall: (job: string) => void; onCancel: () => void }) {
  const auth = useAuthState();
  const install = useInstallOs();
  const [password, setPassword] = useState('');
  const fields = validationFields(install.error);
  const update = state.update;
  const needsPassword = auth.data?.passwordSet ?? false;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    install.mutate(password, { onSuccess: (started) => onInstall(started.id) });
  }

  return (
    <form className={styles.ready} onSubmit={onSubmit}>
      <div className={styles.compare}>
        <div className={styles.compareSide}>
          <span className={styles.compareLabel}>Now</span>
          <span className={styles.compareVersion}>{state.version ?? state.os}</span>
        </div>
        <span className={styles.arrow} aria-hidden>→</span>
        <div className={styles.compareSide}>
          <span className={styles.compareLabel}>New</span>
          <span className={styles.compareVersion}>{update?.version ?? '–'}</span>
        </div>
      </div>
      <div className={styles.badges}>
        <Badge tone="ok">Compatible</Badge>
        {update?.compared === 'same' ? <Badge>Same version</Badge> : null}
        {update?.compared === 'older' ? <Badge tone="warn">Older than the running one</Badge> : null}
        {update?.built ? <span className={styles.note}>Built {new Date(update.built).toLocaleDateString()}</span> : null}
      </div>
      {needsPassword ? (
        <Field label="Enter the password to install" error={fields.password}>
          {(control) => <Input {...control} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />}
        </Field>
      ) : null}
      {failure ? <p className={styles.error} role="alert">{failure}</p> : null}
      <FormError error={install.error} />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" busy={install.isPending}>
          Install
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function Check() {
  return (
    <svg className={styles.check} viewBox="0 0 52 52" aria-hidden>
      <circle className={styles.checkCircle} cx="26" cy="26" r="24" />
      <path className={styles.checkMark} d="M15 27l7 7 15-15" />
    </svg>
  );
}

function Done({ version, onRestarting, onLater }: { version: string | null; onRestarting: () => void; onLater: () => void }) {
  const reboot = useReboot();
  return (
    <div className={styles.result}>
      <Check />
      <p className={styles.resultTitle}>Kaonic OS {version} is installed</p>
      <p className={styles.resultText}>Restart the device to start it. This takes about a minute.</p>
      {reboot.isError ? <p className={styles.error} role="alert">{errorMessage(reboot.error)}</p> : null}
      <div className={styles.actions}>
        <Button variant="primary" busy={reboot.isPending} onClick={() => reboot.mutate(undefined, { onSuccess: onRestarting })}>
          Restart now
        </Button>
        <Button onClick={onLater}>Later</Button>
      </div>
    </div>
  );
}

/** Waits for the device to go away and come back. */
function Restarting({ expected, onBack }: { expected: string | null; onBack: () => void }) {
  useEffect(() => {
    let stopped = false;
    const timer = setInterval(() => {
      api.system
        .os()
        .then((os) => {
          // Until the restart the old process still holds the installed update; the new one has none.
          if (!stopped && os.update === null) {
            stopped = true;
            clearInterval(timer);
            onBack();
          }
        })
        // Away while it restarts.
        .catch(() => undefined);
    }, 2500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [onBack]);
  return (
    <div className={styles.result}>
      <div className={styles.pulse} aria-hidden />
      <p className={styles.resultTitle}>Restarting</p>
      <p className={styles.resultText}>The device is starting Kaonic OS {expected}. This page reconnects when it is back.</p>
    </div>
  );
}
