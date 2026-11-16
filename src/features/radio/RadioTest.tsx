import { useState, type FormEvent } from 'react';
import { validationFields, type ModuleIndex, type RadioBand, type RadioTest, type RadioTestFormat, type RadioTestRequest } from '@/api';
import { TEST_MAX_BYTES, testPayload, testProblems } from '@/api/radioLimits';
import { useRadioTest, useSetMeshRadio, useStartRadioTest, useStopRadioTest } from '@/data/queries';
import { Badge, Button, Dialog, Field, FormError, Input, Notice, Panel, Segmented, Textarea } from '@/ui';
import { BAND_NAMES } from './bands';
import styles from './RadioPage.module.css';

/*
 * Test messages (raw frames on a band, below the mesh) and the choice of the radio module
 * that carries the mesh.
 */

type Mode = 'once' | 'repeat';

const FORMATS = [
  { value: 'text' as const, label: 'Text' },
  { value: 'hex' as const, label: 'Hex' },
];
const MODES = [
  { value: 'once' as const, label: 'Once' },
  { value: 'repeat' as const, label: 'Repeat' },
];

/** "every 1 s", "every 250 ms". */
export function describeInterval(ms: number): string {
  return ms % 1000 === 0 ? `every ${ms / 1000} s` : `every ${ms} ms`;
}

/** What a run did so far, in a sentence. */
export function describeTest(test: RadioTest): string {
  const sent = `${test.sent} sent${test.failed ? `, ${test.failed} failed` : ''}`;
  if (test.intervalMs === null) return test.failed ? 'The message was not sent.' : 'The message was sent.';
  const plan = `${test.bytes} bytes ${describeInterval(test.intervalMs)}${test.count !== null ? `, ${test.count} times` : ''}`;
  return test.running ? `Sending ${plan}: ${sent}.` : `Stopped: ${sent} (${plan}).`;
}

/** A running test on a band, with its Stop button, shown above the band's settings. */
export function RunningTestNotice({ band, canStop }: { band: RadioBand; canStop: boolean }) {
  const test = useRadioTest(band.id, true);
  const stop = useStopRadioTest();
  const current = test.data ?? band.test;
  if (!current?.running) return null;
  return (
    <Notice tone="warn">
      <div className={styles.testRow}>
        <span>Test message: {describeTest(current)}</span>
        {canStop ? (
          <Button type="button" size="small" busy={stop.isPending} onClick={() => stop.mutate(band.id)}>
            Stop
          </Button>
        ) : null}
      </div>
    </Notice>
  );
}

/** Compose and send a test message on one band: once, or repeatedly until stopped. */
export function RadioTestDialog({ band, onClose }: { band: RadioBand; onClose: () => void }) {
  const [message, setMessage] = useState('Kaonic test message');
  const [format, setFormat] = useState<RadioTestFormat>('text');
  const [mode, setMode] = useState<Mode>('once');
  const [intervalMs, setIntervalMs] = useState('1000');
  const [count, setCount] = useState('');
  const start = useStartRadioTest();
  const stop = useStopRadioTest();
  const test = useRadioTest(band.id, true);
  const current = test.data ?? band.test ?? null;
  const running = Boolean(current?.running);
  const mesh = band.usedBy.includes('mesh');

  const request: RadioTestRequest = {
    message,
    format,
    ...(mode === 'repeat' ? { intervalMs: Number(intervalMs) } : {}),
    ...(mode === 'repeat' && count.trim() !== '' ? { count: Number(count) } : {}),
  };
  const problems = testProblems(request);
  const errors = { ...problems, ...validationFields(start.error) };
  const payload = testPayload(message, format);
  const bytes = 'bytes' in payload ? payload.bytes.length : null;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (Object.keys(problems).length === 0) start.mutate({ id: band.id, request });
  }

  return (
    <Dialog title={`Test message on ${BAND_NAMES[band.id]}`} onClose={onClose}>
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <p className={styles.hint}>
          The message goes out as one raw radio frame with this band's settings, for a receiver or spectrum analyser to pick up. Other Kaonic devices do not
          show it.
        </p>
        {mesh ? <Notice>The mesh runs on this band: test messages share the air with it, so keep the interval long while the mesh is in use.</Notice> : null}

        <Segmented label="Message format" options={FORMATS} value={format} onChange={setFormat} />
        <Field
          label="Message"
          hint={bytes !== null ? `${bytes} of ${TEST_MAX_BYTES} bytes` : format === 'hex' ? 'Hex bytes, such as 4b 41 4f 4e 49 43.' : undefined}
          error={errors.message}
        >
          {(control) => <Textarea {...control} rows={5} spellCheck={false} value={message} onChange={(event) => setMessage(event.target.value)} />}
        </Field>

        <Segmented label="How often" options={MODES} value={mode} onChange={setMode} />
        {mode === 'repeat' ? (
          <div className={styles.pair}>
            <Field label="Interval, ms" error={errors.intervalMs}>
              {(control) => <Input {...control} className="num" type="number" min={100} step={100} value={intervalMs} onChange={(event) => setIntervalMs(event.target.value)} />}
            </Field>
            <Field label="Count" hint="Empty: until stopped." error={errors.count}>
              {(control) => <Input {...control} className="num" type="number" min={1} value={count} onChange={(event) => setCount(event.target.value)} />}
            </Field>
          </div>
        ) : null}

        <FormError error={start.error && Object.keys(validationFields(start.error)).length === 0 ? start.error : null} />
        <FormError error={stop.error} />
        {current ? (
          <p className={styles.testStatus} role="status">
            {running ? <Badge tone="accent">Sending</Badge> : null} {describeTest(current)}
            {current.lastError ? ` Last error: ${current.lastError}.` : ''}
          </p>
        ) : null}

        <div className={styles.actions}>
          <Button type="button" onClick={onClose}>
            Close
          </Button>
          <span className={styles.actionGroup}>
            {running ? (
              <Button type="button" variant="danger" busy={stop.isPending} onClick={() => stop.mutate(band.id)}>
                Stop
              </Button>
            ) : null}
            <Button type="submit" variant="primary" busy={start.isPending} disabled={Object.keys(problems).length > 0}>
              {mode === 'once' ? 'Send' : running ? 'Restart' : 'Start'}
            </Button>
          </span>
        </div>
      </form>
    </Dialog>
  );
}

const MODULE_NAMES: Record<ModuleIndex, string> = { 0: 'Radio A', 1: 'Radio B' };

/** Which radio module carries the mesh, and moving it to the other one. */
export function MeshRadioPanel({ bands, isAdmin }: { bands: RadioBand[]; isAdmin: boolean }) {
  const setMeshRadio = useSetMeshRadio();
  const [asking, setAsking] = useState<ModuleIndex | null>(null);
  const mesh = bands.find((band) => band.usedBy.includes('mesh'));
  // No mesh (a laptop) or the emulator's single radio: nothing to choose.
  if (!mesh || mesh.state === 'emulated') return null;
  const target = asking === null ? null : bands.find((band) => band.module === asking && band.range === mesh.range);

  return (
    <Panel title="Mesh radio" actions={<Badge tone="accent">{`${MODULE_NAMES[mesh.module]}${mesh.interface ? `, ${mesh.interface}` : ''}`}</Badge>}>
      <div className={styles.meshRadio}>
        <p className={styles.hint}>
          The mesh, and the VPN and push-to-talk on it, run on one radio module. Move them to the other module if this one has no antenna or is damaged.
        </p>
        <Segmented
          label="Radio module for the mesh"
          options={[
            { value: 0 as ModuleIndex, label: MODULE_NAMES[0] },
            { value: 1 as ModuleIndex, label: MODULE_NAMES[1] },
          ]}
          value={mesh.module}
          onChange={(module) => {
            if (isAdmin && module !== mesh.module) setAsking(module);
          }}
        />
      </div>
      <FormError error={setMeshRadio.error} />
      {setMeshRadio.data?.restarting ? <Notice>The hub is restarting on {setMeshRadio.data.interface}. This page reconnects when it is back.</Notice> : null}

      {asking !== null && target ? (
        <Dialog title={`Move the mesh to ${MODULE_NAMES[asking]}?`} onClose={() => setAsking(null)}>
          <p>
            The mesh band's settings ({mesh.interface}: frequency, modulation, power and filter) are copied to {BAND_NAMES[target.id]}, and the hub restarts
            on it. The mesh, VPN and push-to-talk stop for about half a minute.
          </p>
          <p>Fit an antenna to {MODULE_NAMES[asking]} first. The other nodes are not changed.</p>
          <div className={styles.actions}>
            <Button type="button" onClick={() => setAsking(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              busy={setMeshRadio.isPending}
              onClick={() => {
                const module = asking;
                setAsking(null);
                setMeshRadio.mutate(module);
              }}
            >
              Move and restart
            </Button>
          </div>
        </Dialog>
      ) : null}
    </Panel>
  );
}
