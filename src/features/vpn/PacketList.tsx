import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { CapturedRow } from './captureBuffer';
import { nodeName } from './captureBuffer';
import styles from './VpnPage.module.css';

/** Row height in px: fixed, so only the rows in view are rendered. */
const ROW = 26;
const OVERSCAN = 8;

export type TimeFormat = 'relative' | 'absolute';

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function formatTime(tsUs: number, firstUs: number, format: TimeFormat): string {
  if (format === 'relative') return ((tsUs - firstUs) / 1e6).toFixed(6);
  const date = new Date(Math.floor(tsUs / 1000));
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(tsUs % 1e6, 6)}`;
}

interface PacketListProps {
  rows: readonly CapturedRow[];
  firstUs: number;
  timeFormat: TimeFormat;
  selected: number | null;
  onSelect: (seq: number) => void;
  /** Keep the newest packet in view as packets arrive. */
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
}

/** The packet list, like Wireshark's top pane: only the rows in view are rendered. */
export function PacketList({ rows, firstUs, timeFormat, selected, onSelect, follow, onFollowChange }: PacketListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(360);
  const programmatic = useRef(false);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  // Following: stay at the bottom as packets arrive.
  useEffect(() => {
    const element = scroller.current;
    if (!element || !follow) return;
    programmatic.current = true;
    element.scrollTop = element.scrollHeight;
  }, [rows.length, follow]);

  const selectedIndex = selected === null ? -1 : rows.findIndex((row) => row.packet.seq === selected);

  function moveTo(index: number) {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (!row) return;
    onSelect(row.packet.seq);
    onFollowChange(false);
    const element = scroller.current;
    if (!element) return;
    const top = rows.indexOf(row) * ROW;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW > element.scrollTop + element.clientHeight - ROW) element.scrollTop = top - element.clientHeight + 2 * ROW;
  }

  function onKeyDown(event: KeyboardEvent) {
    const page = Math.max(1, Math.floor(height / ROW) - 1);
    const steps: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page };
    if (event.key in steps) {
      event.preventDefault();
      moveTo((selectedIndex < 0 ? (steps[event.key]! > 0 ? -1 : rows.length) : selectedIndex) + steps[event.key]!);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      moveTo(event.key === 'Home' ? 0 : rows.length - 1);
    }
  }

  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW) + OVERSCAN);
  const visible = rows.slice(first, last);

  return (
    <div className={styles.list} role="grid" aria-label="Captured packets" aria-rowcount={rows.length + 1} aria-readonly="true">
      <div className={`${styles.row} ${styles.header}`} role="row" aria-rowindex={1}>
        <span role="columnheader">No.</span>
        <span role="columnheader">Time</span>
        <span role="columnheader">Source</span>
        <span role="columnheader">Destination</span>
        <span role="columnheader">Protocol</span>
        <span role="columnheader" className={styles.right}>
          Length
        </span>
        <span role="columnheader" className={styles.optional}>
          Node
        </span>
        <span role="columnheader">Info</span>
      </div>
      <div
        ref={scroller}
        className={styles.scroller}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={(event) => {
          const element = event.currentTarget;
          setScrollTop(element.scrollTop);
          if (programmatic.current) {
            programmatic.current = false;
            return;
          }
          const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - ROW;
          if (follow !== atBottom) onFollowChange(atBottom);
        }}
      >
        <div style={{ height: rows.length * ROW, position: 'relative' }}>
          {visible.map((row, offset) => {
            const index = first + offset;
            const packet = row.packet;
            const dropped = packet.verdict === 'dropped';
            return (
              <div
                key={packet.seq}
                role="row"
                aria-rowindex={index + 2}
                aria-selected={packet.seq === selected}
                className={styles.row}
                data-dropped={dropped || undefined}
                data-proto={row.summary.protocol}
                style={{ position: 'absolute', top: index * ROW, height: ROW, left: 0, right: 0 }}
                onClick={() => {
                  onSelect(packet.seq);
                  onFollowChange(false);
                }}
                title={dropped ? `Dropped: ${packet.reason ?? 'no reason given'}` : undefined}
              >
                <span role="gridcell" className="num">
                  <span className={styles.dir} aria-label={packet.direction === 'tx' ? 'sent' : 'received'}>
                    {packet.direction === 'tx' ? '↑' : '↓'}
                  </span>
                  {packet.seq}
                </span>
                <span role="gridcell" className="num">
                  {formatTime(packet.tsUs, firstUs, timeFormat)}
                </span>
                <span role="gridcell" className="num">
                  {row.summary.src || '–'}
                </span>
                <span role="gridcell" className="num">
                  {row.summary.dst || '–'}
                </span>
                <span role="gridcell">{row.summary.protocol}</span>
                <span role="gridcell" className={`num ${styles.right}`}>
                  {packet.len}
                </span>
                <span role="gridcell" className={styles.optional}>
                  {nodeName(packet)}
                </span>
                <span role="gridcell" className={styles.info}>
                  {dropped ? <span className={styles.droppedTag}>[dropped: {packet.reason ?? '?'}] </span> : null}
                  {row.summary.info}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
