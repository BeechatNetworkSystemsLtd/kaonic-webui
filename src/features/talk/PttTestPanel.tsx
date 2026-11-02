import { useRef, useState } from 'react';
import type { PttState } from '@/api';
import { useDeletePttTestWav, usePttTestTone, usePttTestWav, useStartPttTestTx, useStopPttTestTx, useUploadPttTestWav } from '@/data/queries';
import { formatBytes } from '@/lib/format';
import { Button, FormError, Notice, Panel, Switch } from '@/ui';
import { Row } from './controls';
import styles from './TalkPage.module.css';

/*
 * The plugin's test tools: a recording (WAV) or a tone sent to every node as
 * a normal burst, once or looped, and a tone on this device's speaker alone.
 * A test transmission takes the floor like talk does, and is shown on air as
 * this device, source "test".
 */

const MAX_WAV_BYTES = 32 * 1024 * 1024;

const seconds = (durationMs: number) => `${(durationMs / 1000).toFixed(1)} s`;

export function PttTestPanel({ state, canChange }: { state: PttState; canChange: boolean }) {
  const wav = usePttTestWav();
  const upload = useUploadPttTestWav();
  const remove = useDeletePttTestWav();
  const start = useStartPttTestTx();
  const stop = useStopPttTestTx();
  const tone = usePttTestTone();
  const [loop, setLoop] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const testing = state.floor.talker?.local === true && state.floor.talker.source === 'test';
  const running = state.status === 'running';
  const off = !canChange;

  function send(source: 'wav' | 'tone') {
    setRefused(null);
    start.mutate({ source, loop }, { onSuccess: (result) => setRefused(result.keyed ? null : result.reason) });
  }

  return (
    <Panel
      title="Test"
      actions={
        <Button size="small" busy={tone.isPending} disabled={off || !state.audio.device} onClick={() => tone.mutate()}>
          Tone on this device
        </Button>
      }
    >
      <div className={styles.rows}>
        <Row
          label="Test recording"
          hint={
            wav.data
              ? `${seconds(wav.data.durationMs)}, ${formatBytes(wav.data.sizeBytes)}. Sent to every node as talk from this device.`
              : 'A WAV file (PCM, at most 32 MiB) to send to every node, to test the network without talking.'
          }
        >
          <div className={styles.inline}>
            <input
              ref={fileRef}
              className="visually-hidden"
              type="file"
              accept="audio/wav,audio/x-wav,.wav"
              aria-label="Choose a WAV file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                setTooLarge(file.size > MAX_WAV_BYTES);
                if (file.size <= MAX_WAV_BYTES) upload.mutate(file);
              }}
            />
            <Button size="small" busy={upload.isPending} disabled={off} onClick={() => fileRef.current?.click()}>
              {wav.data ? 'Replace' : 'Upload WAV'}
            </Button>
            {wav.data ? (
              <Button size="small" variant="danger" busy={remove.isPending} disabled={off || testing} onClick={() => remove.mutate()}>
                Remove
              </Button>
            ) : null}
          </div>
        </Row>
        {tooLarge ? <Notice tone="warn">That file is larger than 32 MiB.</Notice> : null}
        <Row label="Repeat" hint="Send it again and again until stopped.">
          <Switch label="Repeat" checked={loop} disabled={off || testing} onChange={setLoop} />
        </Row>
        <div className={styles.inline}>
          <Button variant="primary" disabled={off || !running || testing || !wav.data} busy={start.isPending && start.variables?.source === 'wav'} onClick={() => send('wav')}>
            Send recording
          </Button>
          <Button disabled={off || !running || testing} busy={start.isPending && start.variables?.source === 'tone'} onClick={() => send('tone')}>
            Send tone
          </Button>
          <Button variant="danger" disabled={off || !testing} busy={stop.isPending} onClick={() => stop.mutate()}>
            Stop
          </Button>
        </div>
        <p className="visually-hidden" aria-live="polite">
          {testing ? 'Test transmission on air' : ''}
        </p>
        {testing ? <Notice>On air: the test transmission is going to every node.</Notice> : null}
        {refused ? <Notice tone="warn">Not sent: {refused}</Notice> : null}
        <FormError error={upload.error ?? remove.error ?? start.error ?? stop.error ?? tone.error} />
      </div>
    </Panel>
  );
}
