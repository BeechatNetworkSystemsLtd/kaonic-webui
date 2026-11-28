import { useEffect, useLayoutEffect, useReducer, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, errorMessage, validationFields, type Peer, type RemoteShell } from '@/api';
import { useAuthState } from '@/data/queries';
import { shortHash } from '@/lib/format';
import { Button, Dialog, Field, FormError, Input, Notice, Panel, Status, type Tone } from '@/ui';
import { keySequence, lineText, Screen, type Cell, type Style } from './terminal';
import styles from './RemoteShell.module.css';

/*
 * The admin's shell on another node: a terminal over the mesh. Keystrokes go out as
 * typed; the node's output comes back in batches, so on a far node it lags a little.
 */

type ShellState = { kind: 'connecting' } | { kind: 'open' } | { kind: 'closed'; reason: string };

const STATE_TEXT: Record<ShellState['kind'], [string, Tone]> = {
  connecting: ['Starting the shell', 'accent'],
  open: ['Connected', 'ok'],
  closed: ['Closed', 'neutral'],
};

/** Asks for the password if one is set, then opens the shell. */
export function OpenShellDialog({ peer, error, onOpen, onClose }: { peer: Peer; error?: unknown; onOpen: (password: string) => void; onClose: () => void }) {
  const needsPassword = useAuthState().data?.passwordSet ?? true;
  const [password, setPassword] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password || !needsPassword) onOpen(password);
  };
  return (
    <Dialog title="Open a shell" onClose={onClose}>
      <form className={styles.form} onSubmit={submit}>
        <p>
          A root shell on <span className="mono">{shortHash(peer.id)}</span> ({peer.codename}), over the mesh. Everything typed runs on that node as root. Opening it is recorded on
          both devices.
        </p>
        {needsPassword ? (
          <Field label="Enter the password to confirm" error={validationFields(error).password}>
            {(control) => <Input {...control} type="password" autoComplete="current-password" autoFocus required value={password} onChange={(event) => setPassword(event.target.value)} />}
          </Field>
        ) : null}
        <div className={styles.buttons}>
          <Button type="submit" variant="primary" disabled={needsPassword && !password}>
            Open shell
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The terminal, once the password is in. */
export function ShellPanel({ peer, password, onClose }: { peer: Peer; password: string; onClose: (error?: unknown) => void }) {
  // One screen for the panel's life, changed in place by the shell's output; `redraw` shows it.
  const [screen] = useState(() => new Screen(80, 24));
  const shell = useRef<RemoteShell | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<ShellState>({ kind: 'connecting' });
  const [error, setError] = useState<unknown>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const frame = useRef<number | null>(null);
  const scheduleDraw = () => {
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null;
      redraw();
    });
  };

  // Fit the screen to the panel: columns from its width, rows from its height.
  const fit = () => {
    const box = view.current?.getBoundingClientRect();
    const cell = measure.current?.getBoundingClientRect();
    if (!box || !cell || cell.width === 0 || cell.height === 0) return;
    const cols = Math.max(20, Math.floor((box.width - 16) / cell.width));
    const rows = Math.max(5, Math.floor((box.height - 16) / cell.height));
    if (cols !== screen.cols || rows !== screen.rows) {
      screen.resize(cols, rows);
      shell.current?.resize(cols, rows);
      scheduleDraw();
    }
  };

  useLayoutEffect(() => {
    fit();
    const observer = new ResizeObserver(fit);
    if (view.current) observer.observe(view.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The shell is opened once: the password's ticket is good for one socket. A remount right
  // after unmounting (React's development check) keeps it rather than opening another.
  const mounted = useRef(false);
  const started = useRef(false);
  useEffect(() => {
    mounted.current = true;
    if (!started.current) {
      started.current = true;
      const { cols, rows } = screen;
      api.nodes
        .openShell(peer.id, password, { cols, rows }, {
          onOpen: () => {
            setState({ kind: 'open' });
            view.current?.focus();
          },
          onOutput: (bytes) => {
            screen.write(bytes);
            scheduleDraw();
          },
          onClose: (reason) => setState({ kind: 'closed', reason }),
        })
        .then((opened) => {
          if (mounted.current) shell.current = opened;
          else opened.close();
        })
        .catch((failure: unknown) => {
          if (!mounted.current) return;
          // A wrong password goes back to the dialog; anything else is shown here.
          if (validationFields(failure).password) onClose(failure);
          else {
            setError(failure);
            setState({ kind: 'closed', reason: errorMessage(failure) });
          }
        });
    }
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (mounted.current) return;
        shell.current?.close();
        if (frame.current !== null) cancelAnimationFrame(frame.current);
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the newest output in view.
  useLayoutEffect(() => {
    const element = view.current;
    if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 80) element.scrollTop = element.scrollHeight;
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (state.kind !== 'open') return;
    // Let the browser copy a selection with Ctrl+C when there is one.
    if (event.ctrlKey && event.key === 'c' && window.getSelection()?.toString()) return;
    const sequence = keySequence(event);
    if (sequence === null) return;
    event.preventDefault();
    shell.current?.write(sequence);
  };

  const copyAll = () => void navigator.clipboard?.writeText(screen.lines.map(lineText).join('\n').replace(/\n+$/, '\n'));
  const [stateText, tone] = STATE_TEXT[state.kind];
  const { x, y } = screen;
  const lines = screen.lines;
  const cursorLine = screen.scrollback.length + y;

  return (
    <Panel
      title={`Shell on ${peer.codename || shortHash(peer.id)}`}
      actions={
        <span className={styles.actions}>
          <Status tone={tone}>{state.kind === 'closed' && state.reason !== 'Closed.' ? `${stateText}: ${state.reason}` : stateText}</Status>
          <Button size="small" onClick={copyAll}>Copy all</Button>
          {state.kind === 'closed' ? <Button size="small" onClick={() => onClose()}>Dismiss</Button> : <Button size="small" variant="danger" onClick={() => shell.current?.close()}>Close shell</Button>}
        </span>
      }
    >
      {error ? <FormError error={error} /> : null}
      {state.kind === 'open' ? null : state.kind === 'connecting' ? <Notice>Reaching the node; a node a few hops away takes a few seconds.</Notice> : null}
      <div
        ref={view}
        className={styles.terminal}
        tabIndex={0}
        role="textbox"
        aria-label={`Terminal on ${peer.codename}`}
        aria-multiline
        data-closed={state.kind === 'closed' || undefined}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          event.preventDefault();
          if (state.kind === 'open') shell.current?.write(event.clipboardData.getData('text').replace(/\r?\n/g, '\r'));
        }}
      >
        <span ref={measure} className={styles.measure} aria-hidden>
          M
        </span>
        {lines.map((line, index) => (
          <Line key={index} line={line} cursor={state.kind === 'open' && index === cursorLine ? x : null} />
        ))}
      </div>
    </Panel>
  );
}

const sameStyle = (a: Style, b: Style) => a.fg === b.fg && a.bg === b.bg && a.bold === b.bold && a.inverse === b.inverse;

function Line({ line, cursor }: { line: Cell[]; cursor: number | null }) {
  // Runs of one style, the cursor cell on its own.
  const runs: Array<{ text: string; style: Style; cursor: boolean }> = [];
  line.forEach((cell, index) => {
    const isCursor = index === cursor;
    const last = runs[runs.length - 1];
    if (last && !isCursor && !last.cursor && sameStyle(last.style, cell.style)) last.text += cell.char;
    else runs.push({ text: cell.char, style: cell.style, cursor: isCursor });
  });
  return (
    <div className={styles.line}>
      {runs.map((run, index) => {
        const inverse = run.style.inverse !== run.cursor;
        const fg = run.style.fg === null ? undefined : `var(--term-${run.style.fg})`;
        const bg = run.style.bg === null ? undefined : `var(--term-${run.style.bg})`;
        return (
          <span
            key={index}
            className={run.cursor ? styles.cursor : undefined}
            data-bold={run.style.bold || undefined}
            style={inverse ? { color: bg ?? 'var(--term-bg)', background: fg ?? 'var(--term-fg)' } : { color: fg, background: bg }}
          >
            {run.text}
          </span>
        );
      })}
    </div>
  );
}
