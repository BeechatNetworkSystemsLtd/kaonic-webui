import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CapturedRow } from './captureBuffer';
import { nodeName } from './captureBuffer';
import { dissect, fieldAt, type Field } from './dissect';
import styles from './VpnPage.module.css';

/** Each field's place in the tree, like "1.4.2", for expansion state. */
function pathOf(tree: Field[], target: Field): string | null {
  const walk = (fields: Field[], prefix: string): string | null => {
    for (let i = 0; i < fields.length; i += 1) {
      const f = fields[i]!;
      const path = prefix ? `${prefix}.${i}` : String(i);
      if (f === target) return path;
      const inner = f.children ? walk(f.children, path) : null;
      if (inner) return inner;
    }
    return null;
  };
  return walk(tree, '');
}

const ancestors = (path: string) => path.split('.').map((_, i, parts) => parts.slice(0, i + 1).join('.'));

/** The selected packet: Wireshark's middle (tree) and bottom (bytes) panes. */
export function PacketDetails({ row }: { row: CapturedRow }) {
  const packet = row.packet;
  const { tree } = useMemo(
    () =>
      dissect(
        packet.data,
        { seq: packet.seq, tsUs: packet.tsUs, len: packet.len, direction: packet.direction, node: nodeName(packet), verdict: packet.verdict, reason: packet.reason },
        row.relative,
      ),
    [packet, row.relative],
  );
  // The innermost protocol starts open, as in Wireshark after a click.
  const [open, setOpen] = useState<Set<string>>(() => new Set([String(tree.length - 1)]));
  const [selected, setSelected] = useState<string | null>(null);

  const selectedField = useMemo(() => {
    if (selected === null) return null;
    let fields = tree;
    let field: Field | null = null;
    for (const index of selected.split('.').map(Number)) {
      field = fields[index] ?? null;
      fields = field?.children ?? [];
    }
    return field;
  }, [selected, tree]);

  const toggle = (path: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const selectByte = (offset: number) => {
    const field = fieldAt(tree, offset);
    if (!field) return;
    const path = pathOf(tree, field);
    if (!path) return;
    setSelected(path);
    setOpen((current) => new Set([...current, ...ancestors(path).slice(0, -1)]));
  };

  return (
    <div className={styles.details}>
      <div className={styles.tree} role="tree" aria-label={`Packet ${packet.seq} details`}>
        <TreeLevel fields={tree} prefix="" open={open} selected={selected} onToggle={toggle} onSelect={setSelected} depth={0} />
      </div>
      <HexDump data={packet.data} highlight={selectedField && selectedField.end > selectedField.start ? [selectedField.start, selectedField.end] : null} onByte={selectByte} />
    </div>
  );
}

interface TreeLevelProps {
  fields: Field[];
  prefix: string;
  open: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  depth: number;
}

function TreeLevel({ fields, prefix, open, selected, onToggle, onSelect, depth }: TreeLevelProps) {
  return (
    <>
      {fields.map((field, index) => {
        const path = prefix ? `${prefix}.${index}` : String(index);
        const hasChildren = Boolean(field.children?.length);
        const expanded = open.has(path);
        return (
          <div key={path} role="treeitem" aria-expanded={hasChildren ? expanded : undefined} aria-selected={selected === path} aria-level={depth + 1}>
            <div
              className={styles.treeRow}
              data-selected={selected === path || undefined}
              data-warn={field.warn || undefined}
              data-truncated={field.truncated || undefined}
              style={{ paddingLeft: `calc(${depth} * 1.1rem + 0.25rem)` }}
              onClick={() => onSelect(path)}
              onDoubleClick={() => hasChildren && onToggle(path)}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className={styles.twisty}
                  aria-label={expanded ? 'Collapse' : 'Expand'}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggle(path);
                  }}
                >
                  {expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                </button>
              ) : (
                <span className={styles.twisty} aria-hidden />
              )}
              <span>
                {field.label}
                {field.value !== undefined && field.value !== '' ? <>: {field.value}</> : null}
              </span>
            </div>
            {hasChildren && expanded ? (
              <div role="group">
                <TreeLevel fields={field.children!} prefix={path} open={open} selected={selected} onToggle={onToggle} onSelect={onSelect} depth={depth + 1} />
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

const printable = (byte: number) => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.');

/** Hex and ASCII, 16 bytes a line; the selected field's bytes are highlighted. */
function HexDump({ data, highlight, onByte }: { data: Uint8Array; highlight: [number, number] | null; onByte: (offset: number) => void }) {
  const lines = [];
  for (let at = 0; at < data.length; at += 16) {
    const bytes = Array.from(data.subarray(at, at + 16));
    lines.push(
      <div key={at} className={styles.hexLine}>
        <span className={styles.hexOffset}>{at.toString(16).padStart(4, '0')}</span>
        <span className={styles.hexBytes}>
          {bytes.map((byte, i) => {
            const offset = at + i;
            const on = highlight !== null && offset >= highlight[0] && offset < highlight[1];
            return (
              <span key={offset} className={styles.hexByte} data-on={on || undefined} onClick={() => onByte(offset)}>
                {byte.toString(16).padStart(2, '0')}
              </span>
            );
          })}
        </span>
        <span className={styles.hexAscii}>
          {bytes.map((byte, i) => {
            const offset = at + i;
            const on = highlight !== null && offset >= highlight[0] && offset < highlight[1];
            return (
              <span key={offset} data-on={on || undefined} onClick={() => onByte(offset)}>
                {printable(byte)}
              </span>
            );
          })}
        </span>
      </div>,
    );
  }
  return (
    <div className={styles.hex} aria-label="Packet bytes">
      {lines.length ? lines : <p className={styles.muted}>No bytes captured.</p>}
    </div>
  );
}
