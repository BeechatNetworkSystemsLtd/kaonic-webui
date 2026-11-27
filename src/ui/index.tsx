import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { CircleAlert, Info, X } from 'lucide-react';
import { errorMessage, isApiError } from '@/api';
import styles from './ui.module.css';

/*
 * The UI kit. Small, presentational, no data fetching. Pages are assembled from
 * these so that a visual change is made once.
 */

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent';

const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' ');

/* ── Button ── */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'medium' | 'small';
  block?: boolean;
  /** Shows a spinner and blocks clicks while an action runs. */
  busy?: boolean;
  /** Square button for a lone icon. Needs `aria-label`. */
  iconOnly?: boolean;
}

export function Button({ variant = 'default', size = 'medium', block, busy, iconOnly, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        styles.button,
        variant !== 'default' && styles[variant],
        size === 'small' && styles.small,
        block && styles.block,
        iconOnly && styles.iconOnly,
        className,
      )}
    >
      {busy ? <span className={styles.spinner} aria-hidden /> : null}
      {children}
    </button>
  );
}

/* ── Panel ── */

interface PanelProps {
  title?: ReactNode;
  /** Controls shown at the right of the header. */
  actions?: ReactNode;
  children: ReactNode;
  /** Drop the body padding, for tables and lists that run edge to edge. */
  flush?: boolean;
  className?: string;
}

export function Panel({ title, actions, children, flush, className }: PanelProps) {
  return (
    <section className={cx(styles.panel, className)}>
      {title || actions ? (
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>{title}</h2>
          {actions}
        </header>
      ) : null}
      <div className={flush ? undefined : styles.panelBody}>{children}</div>
    </section>
  );
}

/* ── Status ── */

export function StatusDot({ tone = 'neutral' }: { tone?: Tone }) {
  return <span className={styles.dot} data-tone={tone} aria-hidden />;
}

/** A dot with its meaning in words. State is never shown by colour alone. */
export function Status({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={styles.status}>
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={styles.badge} data-tone={tone}>
      {children}
    </span>
  );
}

/* ── Switch ── */

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** What the switch turns on, for screen readers. */
  label: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={styles.switch}
      onClick={() => onChange(!checked)}
    />
  );
}

/* ── Form ── */

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Receives the ids to wire the control to its label and messages. */
  children: (control: { id: string; 'aria-describedby': string | undefined; 'aria-invalid': boolean | undefined }) => ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children({ id, 'aria-describedby': hint || error ? messageId : undefined, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={messageId} className={styles.fieldError} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(styles.input, className)} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={cx(styles.input, className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(styles.input, styles.textarea, className)} />;
}

/* ── Segmented control ── */

interface SegmentedProps<T extends string | number> {
  /** What is being chosen, for screen readers. */
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}

/** A few mutually exclusive choices shown side by side, e.g. a chart's time range. */
export function Segmented<T extends string | number>({ label, options, value, onChange }: SegmentedProps<T>) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" className={styles.segment} aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ── Dialog ── */

interface DialogProps {
  title: string;
  onClose: () => void;
  /** Room for a long form (settings). */
  wide?: boolean;
  children: ReactNode;
}

/**
 * A modal popup. Render it to open it, stop rendering it to close it.
 *
 * It is the browser's own `<dialog>`: focus stays inside, Escape closes it,
 * and the rest of the page cannot be reached while it is open.
 */
export function Dialog({ title, onClose, wide, children }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      data-wide={wide || undefined}
      aria-labelledby={titleId}
      // Escape asks the dialog to close; let the owner decide, so its state stays the single truth.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // A click on the dimmed area lands on the dialog element itself, not on its content.
      onClick={(event) => event.target === dialog.current && onClose()}
    >
      <header className={styles.dialogHead}>
        <h2 id={titleId} className={styles.dialogTitle}>{title}</h2>
        <Button variant="ghost" iconOnly aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className={styles.dialogBody}>{children}</div>
    </dialog>
  );
}

/* ── Messages ── */

export function Notice({ tone = 'neutral', children }: { tone?: 'neutral' | 'warn' | 'danger'; children: ReactNode }) {
  const Icon = tone === 'neutral' ? Info : CircleAlert;
  return (
    <div className={styles.notice} data-tone={tone} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon aria-hidden />
      <div className={styles.noticeBody}>{children}</div>
    </div>
  );
}

/** A form's failure that no field can show. Rejected fields are left to `validationFields`, which puts them next to their inputs. */
export function FormError({ error }: { error: unknown }) {
  if (!error || (isApiError(error, 'validation_failed') && Object.keys(error.fields).length > 0)) return null;
  return <Notice tone="danger">{errorMessage(error)}</Notice>;
}

/** What a panel shows when its data failed to load. */
export function LoadError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Notice tone="danger">
      <span>{errorMessage(error)}</span>
      {onRetry ? (
        <Button size="small" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </Notice>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      {children}
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: 'grid', gap: 10 }}>
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className={styles.skeleton} style={{ width: `${90 - index * 18}%` }} />
      ))}
    </div>
  );
}

/* ── Data ── */

interface MeterProps {
  label: string;
  /** 0..1 */
  value: number;
  /** The reading in words, e.g. "142 of 427 MB". */
  text: string;
}

export function Meter({ label, value, text }: MeterProps) {
  const ratio = Math.min(1, Math.max(0, value));
  const tone = ratio > 0.9 ? 'danger' : ratio > 0.75 ? 'warn' : 'neutral';
  return (
    <div className={styles.meter}>
      <div className={styles.meterHead}>
        <span className={styles.meterLabel}>{label}</span>
        <span className="num">{text}</span>
      </div>
      <div className={styles.meterTrack} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-valuetext={text}>
        <div className={styles.meterFill} data-tone={tone} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

/** Label/value rows. */
export function KeyValues({ rows }: { rows: Array<[label: string, value: ReactNode]> }) {
  return (
    <dl className={styles.kv}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'contents' }}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
