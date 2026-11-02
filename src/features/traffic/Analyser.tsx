import { useMemo, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { BandId, FrameKind, RadioFrame } from '@/api';
import { BAND_IDS, BAND_NAMES } from '@/features/radio/bands';
import { formatBytes, formatClock, formatFrequency, shortHash } from '@/lib/format';
import { Badge, Button, Dialog, EmptyState, Field, KeyValues, Panel, Select, type Tone } from '@/ui';
import {
  byKind,
  byPeer,
  FRAME_KINDS,
  KIND_HINTS,
  KIND_NAMES,
  matches,
  NO_FILTER,
  peerChoices,
  sizeHistogram,
  totals,
  UNATTRIBUTED,
  type FrameFilter,
} from './frameAnalysis';
import { useAnalyserFrames } from './analyserHistory';
import styles from './TrafficPage.module.css';

/** Rows drawn in the frame list; the breakdowns still count every frame. */
const SHOWN_ROWS = 200;

/** Nodes listed in the breakdown before "show all". */
const SHOWN_NODES = 8;

const KIND_TONE: Record<FrameKind, Tone> = {
  data: 'neutral',
  announce: 'accent',
  link_request: 'neutral',
  proof: 'neutral',
  segment: 'neutral',
  corrupt: 'danger',
};

/** Who a frame was for or from, as well as the hub could tell. */
function frameNode(frame: RadioFrame): string {
  if (frame.peer) return frame.peer;
  if (frame.peerId) return shortHash(frame.peerId);
  if (frame.destinationType === 'link' && frame.destination) return `Link ${shortHash(frame.destination)}`;
  if (frame.destination) return shortHash(frame.destination);
  return '–';
}

/**
 * Every frame of the last 15 minutes, filtered and broken down: who the
 * traffic is with, what it is, how big the frames are, and each frame itself.
 */
export function Analyser() {
  const live = useAnalyserFrames();
  const [paused, setPaused] = useState<readonly RadioFrame[] | null>(null);
  const [filter, setFilter] = useState<FrameFilter>(NO_FILTER);
  const [selected, setSelected] = useState<RadioFrame | null>(null);

  const all = paused ?? live;
  const shown = useMemo(() => all.filter((frame) => matches(frame, filter)), [all, filter]);
  const bands = useMemo(() => BAND_IDS.filter((band) => all.some((frame) => frame.band === band)), [all]);
  const peers = useMemo(() => peerChoices(all), [all]);
  const sum = useMemo(() => totals(shown), [shown]);
  const filtered = filter !== NO_FILTER;
  const set = <K extends keyof FrameFilter>(key: K, value: FrameFilter[K]) => setFilter((current) => ({ ...current, [key]: value }));

  return (
    <Panel
      title="Traffic analyser"
      actions={
        <Button size="small" onClick={() => setPaused(paused ? null : live)} aria-pressed={paused !== null}>
          {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
          {paused ? 'Resume' : 'Pause'}
        </Button>
      }
    >
      <div className={styles.analyser}>
        <div className={styles.filters}>
          <Field label="Band">
            {(control) => (
              <Select {...control} value={filter.band} onChange={(event) => set('band', event.target.value as BandId | 'all')}>
                <option value="all">All bands</option>
                {bands.map((band) => (
                  <option key={band} value={band}>
                    {BAND_NAMES[band]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Direction">
            {(control) => (
              <Select {...control} value={filter.direction} onChange={(event) => set('direction', event.target.value as FrameFilter['direction'])}>
                <option value="all">Both</option>
                <option value="rx">Received</option>
                <option value="tx">Sent</option>
              </Select>
            )}
          </Field>
          <Field label="Kind">
            {(control) => (
              <Select {...control} value={filter.kind} onChange={(event) => set('kind', event.target.value as FrameKind | 'all')}>
                <option value="all">All kinds</option>
                {FRAME_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_NAMES[kind]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Node">
            {(control) => (
              <Select {...control} value={filter.peer} onChange={(event) => set('peer', event.target.value)}>
                <option value="all">All nodes</option>
                {peers.map((peer) => (
                  <option key={peer.id} value={peer.id}>
                    {peer.name}
                  </option>
                ))}
                <option value={UNATTRIBUTED}>Not attributed</option>
              </Select>
            )}
          </Field>
          {filtered ? (
            <Button size="small" variant="ghost" onClick={() => setFilter(NO_FILTER)} className={styles.clear}>
              Clear filters
            </Button>
          ) : null}
        </div>

        <p className={`${styles.summary} num`} aria-live="polite">
          {paused ? <Badge tone="warn">Paused</Badge> : null}
          <span>
            {sum.frames} {sum.frames === 1 ? 'frame' : 'frames'}
            {filtered ? ` of ${all.length}` : ''} in the last 15 min
          </span>
          <span>↓ {formatBytes(sum.rxBytes)}</span>
          <span>↑ {formatBytes(sum.txBytes)}</span>
          <span>{sum.airtimeSecs.toFixed(1)} s on the air</span>
          <span>{(sum.corruptShare * 100).toFixed(1)} % of received frames not decoded</span>
        </p>

        {shown.length === 0 ? (
          <EmptyState title={all.length === 0 ? 'No frames yet' : 'No frame matches these filters'}>
            {all.length === 0 ? 'Frames show here as the radio sends and hears them.' : null}
          </EmptyState>
        ) : (
          <>
            <div className={styles.breakdowns}>
              <PeerBreakdown frames={shown} onPick={(peer) => set('peer', peer)} />
              <KindBreakdown frames={shown} onPick={(kind) => set('kind', kind)} />
              <SizeHistogram frames={shown} />
            </div>
            <FrameTable frames={shown} onSelect={setSelected} />
          </>
        )}
      </div>
      {selected ? <FrameDetails frame={selected} onClose={() => setSelected(null)} /> : null}
    </Panel>
  );
}

function PeerBreakdown({ frames, onPick }: { frames: readonly RadioFrame[]; onPick: (peer: string) => void }) {
  const rows = useMemo(() => byPeer(frames), [frames]);
  const [showAll, setShowAll] = useState(false);
  const named = rows.filter((row) => row.id !== UNATTRIBUTED);
  // Frames no node can be named for (undecodable ones among them) always stay in view, last.
  const visible = [...(showAll ? named : named.slice(0, SHOWN_NODES)), ...rows.filter((row) => row.id === UNATTRIBUTED)];
  return (
    <section className={styles.breakdown}>
      <h3 className={styles.subtitle}>By node</h3>
      <div className={styles.scroll}>
        <table className={`${styles.table} ${styles.compact}`}>
          <thead>
            <tr>
              <th scope="col">Node</th>
              <th scope="col" className={styles.number}>Frames</th>
              <th scope="col" className={styles.number}>↓</th>
              <th scope="col" className={styles.number}>↑</th>
              <th scope="col" className={styles.number}>Signal</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  <button type="button" className={styles.pick} onClick={() => onPick(row.id)} title={`Show only ${row.name}`}>
                    {row.name}
                  </button>
                </th>
                <td className={`${styles.number} num`}>{row.frames}</td>
                <td className={`${styles.number} num`}>{formatBytes(row.rxBytes)}</td>
                <td className={`${styles.number} num`}>{formatBytes(row.txBytes)}</td>
                <td className={`${styles.number} num`}>{row.avgRssi !== null ? `${row.avgRssi} dBm` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {named.length > SHOWN_NODES ? (
        <Button size="small" variant="ghost" className={styles.clear} onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
          {showAll ? 'Show the busiest only' : `Show all ${named.length} nodes`}
        </Button>
      ) : null}
    </section>
  );
}

function KindBreakdown({ frames, onPick }: { frames: readonly RadioFrame[]; onPick: (kind: FrameKind) => void }) {
  const rows = useMemo(() => byKind(frames), [frames]);
  return (
    <section className={styles.breakdown}>
      <h3 className={styles.subtitle}>By kind</h3>
      <ul className={styles.shares}>
        {rows.map((row) => (
          <li key={row.kind} className={styles.share} title={KIND_HINTS[row.kind]}>
            <button type="button" className={styles.pick} onClick={() => onPick(row.kind)} disabled={row.frames === 0}>
              {KIND_NAMES[row.kind]}
            </button>
            <span className={`${styles.shareValue} num`}>
              {row.frames} · {(row.share * 100).toFixed(0)} %
            </span>
            <span className={styles.shareTrack} aria-hidden>
              <span className={styles.shareFill} data-kind={row.kind} style={{ width: `${row.share * 100}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SizeHistogram({ frames }: { frames: readonly RadioFrame[] }) {
  const buckets = useMemo(() => sizeHistogram(frames), [frames]);
  const most = Math.max(1, ...buckets.map((bucket) => bucket.frames));
  const name = (from: number, to: number | null) => (to === null ? `${from} B and up` : `${from}–${to - 1} B`);
  return (
    <section className={styles.breakdown}>
      <h3 className={styles.subtitle}>Frame sizes</h3>
      <div className={styles.histogram} role="list" aria-label="Frames by size">
        {buckets.map((bucket) => (
          <div key={bucket.from} className={styles.column} role="listitem" aria-label={`${name(bucket.from, bucket.to)}: ${bucket.frames} frames`} title={`${name(bucket.from, bucket.to)}: ${bucket.frames} frames`}>
            <span className={`${styles.columnValue} num`} aria-hidden>
              {bucket.frames > 0 ? bucket.frames : ''}
            </span>
            <span className={styles.columnTrack} aria-hidden>
              <span className={styles.columnFill} style={{ height: `${(bucket.frames / most) * 100}%` }} />
            </span>
            <span className={`${styles.columnLabel} num`} aria-hidden>
              {bucket.to === null ? `${bucket.from / 1024}k+` : bucket.from >= 1024 ? `${bucket.from / 1024}k` : bucket.from}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function FrameTable({ frames, onSelect }: { frames: readonly RadioFrame[]; onSelect: (frame: RadioFrame) => void }) {
  // Newest first; only the latest are drawn.
  const rows = useMemo(() => frames.slice(-SHOWN_ROWS).reverse(), [frames]);
  return (
    <section className={styles.breakdown}>
      <h3 className={styles.subtitle}>
        Frames{frames.length > SHOWN_ROWS ? <span className={styles.muted}> · latest {SHOWN_ROWS} of {frames.length}</span> : null}
      </h3>
      <div className={`${styles.scroll} ${styles.tall}`}>
        <table className={`${styles.table} ${styles.frames}`}>
          <caption className="visually-hidden">Frames, newest first. Choose a time to see a frame in full.</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Band</th>
              <th scope="col">Way</th>
              <th scope="col">Kind</th>
              <th scope="col">Node</th>
              <th scope="col" className={styles.number}>Hops</th>
              <th scope="col" className={styles.number}>Size</th>
              <th scope="col" className={styles.number}>Signal</th>
              <th scope="col" className={styles.number}>Air time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((frame, index) => (
              <tr key={`${frame.ts}-${frame.band}-${index}`} onClick={() => onSelect(frame)} data-kind={frame.kind}>
                <td className="num">
                  <button type="button" className={styles.pick} onClick={(event) => (event.stopPropagation(), onSelect(frame))}>
                    {formatClock(frame.ts)}
                  </button>
                </td>
                <td>{BAND_NAMES[frame.band].replace('Radio ', '')}</td>
                <td>{frame.direction === 'rx' ? '↓ In' : '↑ Out'}</td>
                <td>
                  <Badge tone={KIND_TONE[frame.kind]}>{KIND_NAMES[frame.kind]}</Badge>
                </td>
                <td title={frame.peerId ?? frame.destination ?? undefined}>{frameNode(frame)}</td>
                <td className={`${styles.number} num`}>{frame.hops ?? '–'}</td>
                <td className={`${styles.number} num`}>{frame.len} B</td>
                <td className={`${styles.number} num`}>{frame.rssi !== null ? `${frame.rssi} dBm` : '–'}</td>
                <td className={`${styles.number} num`}>{frame.durationMs.toFixed(1)} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const DESTINATION_TYPES = { single: 'A node', group: 'A group', plain: 'Anyone (plain)', link: 'A link' } as const;

function FrameDetails({ frame, onClose }: { frame: RadioFrame; onClose: () => void }) {
  return (
    <Dialog title={`${KIND_NAMES[frame.kind]} frame, ${frame.direction === 'rx' ? 'received' : 'sent'}`} onClose={onClose}>
      <p className={styles.muted}>{KIND_HINTS[frame.kind]}</p>
      <KeyValues
        rows={[
          ['Time', <span key="time" className="num">{`${new Date(frame.ts).toLocaleDateString()} ${formatClock(frame.ts)}`}</span>],
          ['Band', BAND_NAMES[frame.band]],
          ['Channel', <span key="freq" className="num">{`${formatFrequency(frame.frequencyHz)}, ${(frame.bandwidthHz / 1000).toFixed(0)} kHz wide`}</span>],
          ['Frame', <span key="len" className="num">{`${frame.len} bytes, ${frame.durationMs.toFixed(2)} ms on the air`}</span>],
          ['Packet', <span key="packet" className="num">{frame.packetLen !== null ? `${frame.packetLen} bytes` : 'Not complete in this frame'}</span>],
          ['Signal', <span key="rssi" className="num">{frame.rssi !== null ? `${frame.rssi} dBm` : 'Sent by this device'}</span>],
          ['Hops', <span key="hops" className="num">{frame.hops ?? '–'}</span>],
          ['Addressed to', frame.destinationType ? DESTINATION_TYPES[frame.destinationType] : '–'],
          ['Destination', <code key="dest" className={styles.hash}>{frame.destination ?? '–'}</code>],
          ['Node', frame.peerId ? <span key="node">{frame.peer ?? 'Unnamed'} <code className={styles.hash}>{frame.peerId}</code></span> : 'Not known'],
        ]}
      />
    </Dialog>
  );
}
