import { useState, type ChangeEvent, type FormEvent } from 'react';
import { errorMessage, validationFields, type BootImage, type BootMode, type BootSlotId } from '@/api';
import {
  useBoot,
  useBootJob,
  useBootStaged,
  useDiscardStagedBoot,
  useInstallKernel,
  useReboot,
  useSetBootNext,
  useUploadBootImage,
} from '@/data/queries';
import { formatBytes } from '@/lib/format';
import { Badge, Button, Field, FormError, Input, LoadError, Meter, Notice, Panel, Segmented, Skeleton, Status, Switch } from '@/ui';
import { attemptsText, nextBootText, otherSlot, slotName, slotSummary } from './bootView';
import styles from './SystemPage.module.css';

/** The A/B boot slots, the boot switch and kernel install (docs/kernel-update.md). */
export function BootPanel() {
  const boot = useBoot();
  return (
    <Panel title="Boot and kernel">
      {boot.isPending ? (
        <Skeleton lines={5} />
      ) : boot.isError ? (
        <LoadError error={boot.error} onRetry={() => void boot.refetch()} />
      ) : (
        <div className={styles.maintenance}>
          {boot.data.dryRun ? <Notice tone="warn">The hub runs in dry-run mode: boot changes are only logged, nothing is written.</Notice> : null}
          <p>{nextBootText(boot.data)}</p>
          <ul className={styles.slots}>
            {boot.data.slots.map((slot) => (
              <li key={slot.slot} className={styles.slot}>
                <div className={styles.slotHead}>
                  <strong>{slotName(slot.slot)}</strong>
                  {slot.slot === boot.data.current ? <Badge tone="ok">Running</Badge> : null}
                  {slot.slot === boot.data.next && slot.slot !== boot.data.current ? <Badge tone="accent">Boots next{boot.data.once ? ' (once)' : ''}</Badge> : null}
                </div>
                <p className={styles.unit}>{slotSummary(slot)}</p>
                <p className={styles.unit}>Boot attempts: {attemptsText(slot)}</p>
                {slot.kernel?.file ? <p className={`${styles.unit} mono`}>{slot.kernel.file}</p> : null}
              </li>
            ))}
          </ul>
          <BootSwitch current={boot.data.current} bootable={Object.fromEntries(boot.data.slots.map((slot) => [slot.slot, slot.bootable]))} />
          <KernelInstall target={boot.data.current ? otherSlot(boot.data.current) : 'b'} />
        </div>
      )}
    </Panel>
  );
}

function BootSwitch({ current, bootable }: { current: BootSlotId | null; bootable: Record<string, boolean> }) {
  const [slot, setSlot] = useState<BootSlotId>(current ? otherSlot(current) : 'b');
  const [mode, setMode] = useState<BootMode>('once');
  const [password, setPassword] = useState('');
  const [open, setOpen] = useState(false);
  const setNext = useSetBootNext();
  const reboot = useReboot();
  const fields = validationFields(setNext.error);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setNext.mutate({ slot, mode, password }, { onSuccess: () => setPassword('') });
  }

  return (
    <div className={styles.bootBlock}>
      <div className={styles.action}>
        <div>
          <p className={styles.serviceName}>Boot switch</p>
          <p className={styles.unit}>Choose the slot the board starts from. "Once" tries it on the next restart only; the running slot comes back after it, and also if it fails.</p>
        </div>
        {!open ? <Button onClick={() => setOpen(true)}>Change…</Button> : null}
      </div>
      {open ? (
        <form className={styles.confirm} onSubmit={onSubmit}>
          <Segmented label="Slot" options={[{ value: 'a', label: 'Slot A' }, { value: 'b', label: 'Slot B' }]} value={slot} onChange={setSlot} />
          <Segmented label="How long" options={[{ value: 'once', label: 'Next boot only' }, { value: 'permanent', label: 'From now on' }]} value={mode} onChange={setMode} />
          {!bootable[slot] ? <Notice tone="warn">{slotName(slot)} has no system to boot. Install a kernel into it first.</Notice> : null}
          <Field label="Enter the password to confirm" error={fields.password}>
            {(control) => <Input {...control} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />}
          </Field>
          <FormError error={setNext.error} />
          {setNext.isSuccess ? <Notice>Saved. Restart the device to boot {slotName(slot)}.</Notice> : null}
          <div className={styles.confirmActions}>
            <Button type="submit" variant="primary" busy={setNext.isPending} disabled={!bootable[slot]}>
              Save
            </Button>
            {setNext.isSuccess ? (
              <Button variant="danger" busy={reboot.isPending} onClick={() => reboot.mutate()}>
                Restart now
              </Button>
            ) : null}
            <Button onClick={() => { setOpen(false); setPassword(''); setNext.reset(); }}>Close</Button>
          </div>
          {reboot.isSuccess ? <Notice>The device is restarting. This page reconnects when it is back.</Notice> : null}
          {reboot.isError ? <Notice tone="danger">{errorMessage(reboot.error)}</Notice> : null}
        </form>
      ) : null}
    </div>
  );
}

function ImageLine({ info }: { info: BootImage }) {
  return (
    <p className={styles.unit}>
      <Status tone="ok">{info.kind === 'kernel' ? 'Kernel' : 'Device tree'}</Status> {info.name ?? info.format}, {formatBytes(info.size)}
      {info.kind === 'kernel' && info.loadAddress ? `, load ${info.loadAddress}` : ''}
    </p>
  );
}

function KernelInstall({ target }: { target: BootSlotId }) {
  const staged = useBootStaged();
  const upload = useUploadBootImage();
  const discard = useDiscardStagedBoot();
  const install = useInstallKernel();
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useBootJob(jobId);
  const [password, setPassword] = useState('');
  const [fresh, setFresh] = useState(false);
  const [allowMissing, setAllowMissing] = useState(false);
  const fields = validationFields(install.error);
  const uploadFields = validationFields(upload.error);

  function onFile(kind: 'kernel' | 'dtb') {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) upload.mutate({ kind, file });
    };
  }

  function onInstall(event: FormEvent) {
    event.preventDefault();
    install.mutate(
      { password, slot: target, prepare: fresh ? 'always' : 'auto', allowMissingModules: allowMissing },
      { onSuccess: (started) => { setJobId(started.id); setPassword(''); } },
    );
  }

  const hasStaged = Boolean(staged.data?.kernel || staged.data?.dtb);
  const running = job.data && (job.data.state === 'running' || job.data.state === 'queued');

  return (
    <div className={styles.bootBlock}>
      <div className={styles.action}>
        <div>
          <p className={styles.serviceName}>Kernel update</p>
          <p className={styles.unit}>
            Upload a kernel (U-Boot uImage) and, if it needs one, its device tree. They go into {slotName(target)}, the slot that is not running; the
            running system is never written. Then boot {slotName(target)} once to try it.
          </p>
        </div>
      </div>
      <div className={styles.confirmActions}>
        <label className={styles.fileButton}>
          Choose kernel…
          <input type="file" className={styles.fileInput} accept=".bin,.img,uImage,application/octet-stream" onChange={onFile('kernel')} />
        </label>
        <label className={styles.fileButton}>
          Choose device tree…
          <input type="file" className={styles.fileInput} accept=".dtb" onChange={onFile('dtb')} />
        </label>
      </div>
      {upload.isPending ? <p className={styles.unit}>Checking the file…</p> : null}
      {uploadFields.file ? <Notice tone="danger">{uploadFields.file}</Notice> : <FormError error={upload.error} />}
      {staged.data?.kernel ? <ImageLine info={staged.data.kernel.info} /> : null}
      {staged.data?.dtb ? <ImageLine info={staged.data.dtb.info} /> : null}
      {hasStaged && !running ? (
        <form className={styles.confirm} onSubmit={onInstall}>
          <div className={styles.toggle}>
            <Switch checked={fresh} onChange={setFresh} label="Copy the running system into the slot first" />
            <span>Copy the running system into {slotName(target)} first (otherwise only when it is empty)</span>
          </div>
          <div className={styles.toggle}>
            <Switch checked={allowMissing} onChange={setAllowMissing} label="Install even without matching kernel modules" />
            <span>Install even if the slot has no modules for this kernel (the radio driver would not load)</span>
          </div>
          <Field label="Enter the password to confirm" error={fields.password}>
            {(control) => <Input {...control} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />}
          </Field>
          <FormError error={install.error} />
          <div className={styles.confirmActions}>
            <Button type="submit" variant="primary" busy={install.isPending}>
              Install into {slotName(target)}
            </Button>
            <Button busy={discard.isPending} onClick={() => discard.mutate()}>
              Discard
            </Button>
          </div>
        </form>
      ) : null}
      {job.data ? (
        job.data.state === 'failed' ? (
          <Notice tone="danger">{job.data.error ?? 'The install failed.'}</Notice>
        ) : job.data.state === 'done' && job.data.result ? (
          <Notice>
            Installed into {slotName(job.data.result.slot)}
            {job.data.result.prepared ? ' (the running system was copied into it first)' : ''}
            {job.data.result.kernelFile ? `: ${job.data.result.kernelFile}` : ''}. Use the boot switch to try it once, then restart.
          </Notice>
        ) : (
          <Meter label={job.data.detail ?? 'Installing'} value={job.data.progress} text={`${Math.round(job.data.progress * 100)}%`} />
        )
      ) : null}
    </div>
  );
}
