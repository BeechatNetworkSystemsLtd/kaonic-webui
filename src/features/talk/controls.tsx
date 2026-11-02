import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './TalkPage.module.css';

/** A label (with an optional hint) and its control, side by side. */
export function Row({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div>
        <div className={styles.rowLabel}>{label}</div>
        {hint ? <div className={styles.muted}>{hint}</div> : null}
        {error ? (
          <div className={styles.fieldError} role="alert">
            {error}
          </div>
        ) : null}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

/** A slider that saves a moment after it stops moving. */
export function RangeSetting({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  format = (shown) => String(shown),
  disabled,
  error,
  onCommit,
  children,
}: {
  label: string;
  hint?: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  disabled: boolean;
  error?: string;
  onCommit: (value: number) => void;
  /** Drawn under the slider (a live level, for instance). */
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const shown = draft ?? value;
  return (
    <div className={styles.rangeBlock}>
      <label className={styles.range}>
        <span className={styles.rangeHead}>
          <span className={styles.rowLabel}>{label}</span>
          <span className="num">{format(shown)}</span>
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={shown}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            const next = Number(event.target.value);
            setDraft(next);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              onCommit(next);
              setDraft(null);
            }, 400);
          }}
        />
      </label>
      {children}
      {hint ? <div className={styles.muted}>{hint}</div> : null}
      {error ? (
        <div className={styles.fieldError} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
