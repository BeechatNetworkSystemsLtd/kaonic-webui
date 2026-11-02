import { useDeferredValue, useMemo, useState, type FormEvent } from 'react';
import { Download, Play, Square, Trash2 } from 'lucide-react';
import { api, validationFields, type VpnCapture } from '@/api';
import { useStartVpnCapture, useStopVpnCapture, useVpnCapture } from '@/data/queries';
import { formatBytes, formatCount, formatDuration } from '@/lib/format';
import { Badge, Button, EmptyState, Field, FormError, Input, LoadError, Notice, Panel, Segmented, Skeleton, Status, Switch } from '@/ui';
import { checkFilter, compileFilter } from './filter';
import { PacketDetails } from './PacketDetails';
import { PacketList, type TimeFormat } from './PacketList';
import { writePcap } from './pcap';
import { CAPTURE_KEEP, useCapturePackets, useNow } from './useCapture';
import styles from './VpnPage.module.css';

const EXAMPLES = ['tcp', 'udp.port == 53', 'icmp', 'verdict == dropped', 'tcp.flags.syn == 1'];

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const fileStamp = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace(/[:T]/g, '-');

/** The tunnel packet capture, Wireshark style. Admin sessions only. */
export function CapturePanel({ admin }: { admin: boolean }) {
  const capture = useVpnCapture(admin);
  // Kept here, above the per-capture remount, so a filter typed before starting stays.
  const view = useViewState();

  if (!admin) {
    return (
      <Panel title="Packet capture">
        <Notice>Capturing tunnel packets needs an admin session: captures can hold people's traffic.</Notice>
      </Panel>
    );
  }
  if (capture.isPending) {
    return (
      <Panel title="Packet capture">
        <Skeleton lines={4} />
      </Panel>
    );
  }
  if (capture.isError) {
    return (
      <Panel title="Packet capture">
        <LoadError error={capture.error} onRetry={() => void capture.refetch()} />
      </Panel>
    );
  }
  // A new capture numbers its packets from 1 again: start over with it.
  return <Capture key={capture.data.startedTs ?? 'none'} state={capture.data} view={view} />;
}

type ViewState = ReturnType<typeof useViewState>;

function useViewState() {
  const [filterText, setFilterText] = useState('');
  const [applied, setApplied] = useState('');
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('relative');
  return { filterText, setFilterText, applied, setApplied, timeFormat, setTimeFormat };
}

function Capture({ state, view }: { state: VpnCapture; view: ViewState }) {
  const packets = useCapturePackets(state);
  const { filterText, setFilterText, applied, setApplied, timeFormat, setTimeFormat } = view;
  const [selected, setSelected] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);
  const check = useMemo(() => checkFilter(filterText), [filterText]);
  const deferredRows = useDeferredValue(packets.rows);

  const filter = useMemo(() => (checkFilter(applied).ok ? compileFilter(applied) : null), [applied]);
  const shown = useMemo(() => (filter ? deferredRows.filter((row) => filter.test(row.record)) : deferredRows), [filter, deferredRows]);
  const firstUs = packets.rows[0]?.packet.tsUs ?? 0;
  const selectedRow = selected === null ? null : (packets.rows.find((row) => row.packet.seq === selected) ?? null);

  const apply = (event?: FormEvent) => {
    event?.preventDefault();
    if (check.ok) setApplied(filterText);
  };

  return (
    <Panel
      title="Packet capture"
      actions={
        state.running ? (
          <Status tone="ok">Capturing</Status>
        ) : state.startedTs !== null ? (
          <Status tone="neutral">Stopped</Status>
        ) : (
          <Status tone="neutral">Off</Status>
        )
      }
    >
      <div className={styles.capture}>
        <CaptureControls state={state} shownCount={shown.length} onSaveShown={() => save(new Blob([writePcap(shown.map((row) => row.packet))]), `kaonic-vpn-displayed-${fileStamp(Date.now())}.pcap`)} onClearView={() => {
          packets.clearView();
          setSelected(null);
        }} />

        <form className={styles.filterBar} onSubmit={apply} role="search">
          <label className="visually-hidden" htmlFor="vpn-display-filter">
            Display filter
          </label>
          <Input
            id="vpn-display-filter"
            className={styles.filterInput}
            data-valid={filterText.trim() === '' ? undefined : check.ok ? 'yes' : 'no'}
            placeholder="Apply a display filter … (e.g. tcp.port == 443 && ip.addr == 10.77.0.0/16)"
            value={filterText}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!check.ok || undefined}
            aria-describedby="vpn-filter-help"
            onChange={(event) => setFilterText(event.target.value)}
          />
          <Button type="submit" size="small" disabled={!check.ok}>
            Apply
          </Button>
          {applied ? (
            <Button
              size="small"
              variant="ghost"
              onClick={() => {
                setFilterText('');
                setApplied('');
              }}
            >
              Clear
            </Button>
          ) : null}
        </form>
        <p id="vpn-filter-help" className={check.ok ? styles.muted : styles.filterError} role={check.ok ? undefined : 'alert'}>
          {check.ok ? (
            <>
              Try{' '}
              {EXAMPLES.map((example, i) => (
                <span key={example}>
                  {i ? ', ' : ''}
                  <button type="button" className={styles.example} onClick={() => {
                    setFilterText(example);
                    setApplied(example);
                  }}>
                    {example}
                  </button>
                </span>
              ))}
              . Press Enter to apply.
            </>
          ) : (
            <>
              {check.message} <span className={styles.position}>(at character {check.position + 1})</span>
            </>
          )}
        </p>

        <div className={styles.listBar}>
          <span className={styles.muted}>
            {applied ? `Displayed ${formatCount(shown.length)} of ${formatCount(packets.rows.length)}` : `${formatCount(packets.rows.length)} packets`}
            {packets.rows.length >= CAPTURE_KEEP ? ` (the page keeps the newest ${formatCount(CAPTURE_KEEP)})` : ''}
          </span>
          <div className={styles.listTools}>
            <Segmented
              label="Time column"
              options={[
                { value: 'relative', label: 'Since first' },
                { value: 'absolute', label: 'Time of day' },
              ]}
              value={timeFormat}
              onChange={setTimeFormat}
            />
            <label className={styles.followLabel}>
              <Switch checked={follow} onChange={setFollow} label="Follow new packets" />
              Follow
            </label>
          </div>
        </div>

        {packets.error ? <LoadError error={packets.error} /> : null}
        {packets.rows.length === 0 ? (
          <EmptyState title={state.running ? 'Waiting for packets' : 'No packets captured'}>
            {state.running ? 'Packets show here as they cross the tunnel.' : 'Start a capture to see the packets crossing the tunnel.'}
          </EmptyState>
        ) : (
          <PacketList rows={shown} firstUs={firstUs} timeFormat={timeFormat} selected={selected} onSelect={setSelected} follow={follow} onFollowChange={setFollow} />
        )}

        {selectedRow ? <PacketDetails key={selectedRow.packet.seq} row={selectedRow} /> : packets.rows.length ? <p className={styles.muted}>Select a packet to see its fields and bytes.</p> : null}
      </div>
    </Panel>
  );
}

interface ControlsProps {
  state: VpnCapture;
  shownCount: number;
  onSaveShown: () => void;
  onClearView: () => void;
}

function CaptureControls({ state, shownCount, onSaveShown, onClearView }: ControlsProps) {
  const start = useStartVpnCapture();
  const stop = useStopVpnCapture();
  const [snaplen, setSnaplen] = useState(String(state.snaplen || 128));
  const [maxPackets, setMaxPackets] = useState(String(state.maxPackets || 5000));
  const [maxSecs, setMaxSecs] = useState(String(state.maxSecs || 600));
  const [ring, setRing] = useState(state.ring);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const fields = validationFields(start.error);
  const now = useNow(state.running);
  const elapsed = state.startedTs === null ? 0 : ((state.running ? now : (state.stoppedTs ?? now)) - state.startedTs) / 1000;

  const onStart = (event: FormEvent) => {
    event.preventDefault();
    start.mutate({ snaplen: Number(snaplen), maxPackets: Number(maxPackets), maxSecs: Number(maxSecs), ring });
  };

  const download = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      save(await api.vpn.capturePcap(), `kaonic-vpn-${fileStamp(state.startedTs ?? Date.now())}.pcap`);
    } catch (error) {
      setDownloadError(error);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className={styles.controls}>
      <p className={styles.muted}>
        Captures are off until an admin starts one, live in the device's memory only, and are gone when the hub restarts. Only the first bytes of each
        packet are kept (the snap length): 128 bytes hold the headers and little of what people send. Downloads open in Wireshark.
      </p>
      {state.running ? null : (
        <form className={styles.startForm} onSubmit={onStart}>
          <Field label="Snap length (bytes)" error={fields.snaplen} hint="64–1500">
            {(control) => <Input {...control} type="number" min={64} max={1500} value={snaplen} onChange={(e) => setSnaplen(e.target.value)} />}
          </Field>
          <Field label="Max packets" error={fields.maxPackets} hint="100–20000">
            {(control) => <Input {...control} type="number" min={100} max={20000} value={maxPackets} onChange={(e) => setMaxPackets(e.target.value)} />}
          </Field>
          <Field label="Max duration (s)" error={fields.maxSecs} hint="10–3600">
            {(control) => <Input {...control} type="number" min={10} max={3600} value={maxSecs} onChange={(e) => setMaxSecs(e.target.value)} />}
          </Field>
          <label className={styles.ringLabel}>
            <Switch checked={ring} onChange={setRing} label="Keep the newest packets when full" />
            Keep newest when full
          </label>
          <Button type="submit" variant="primary" busy={start.isPending}>
            <Play aria-hidden /> Start capture
          </Button>
        </form>
      )}
      <FormError error={start.error ?? stop.error ?? downloadError} />
      <div className={styles.captureState}>
        <span className="num">
          {formatCount(state.packets)} packets · {formatBytes(state.bytes)} · {formatDuration(Math.round(elapsed))}
          {state.dropped > 0 ? (
            <>
              {' '}
              · <Badge tone="warn">{formatCount(state.dropped)} {state.ring ? 'pushed out' : 'not kept'}</Badge>
            </>
          ) : null}
        </span>
        <div className={styles.captureButtons}>
          {state.running ? (
            <Button variant="danger" size="small" busy={stop.isPending} onClick={() => stop.mutate()}>
              <Square aria-hidden /> Stop
            </Button>
          ) : null}
          <Button size="small" onClick={onClearView} title="Empty this list; packets keep arriving">
            <Trash2 aria-hidden /> Clear view
          </Button>
          <Button size="small" busy={downloading} disabled={state.packets === 0} onClick={() => void download()} title="The whole capture, from the device">
            <Download aria-hidden /> Download .pcap
          </Button>
          <Button size="small" variant="ghost" disabled={shownCount === 0} onClick={onSaveShown} title="Only the packets the display filter shows">
            Save displayed
          </Button>
        </div>
      </div>
    </div>
  );
}
