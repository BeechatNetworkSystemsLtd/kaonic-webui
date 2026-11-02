import type { ComponentType } from 'react';
import { TrafficPanel } from '@/features/traffic/TrafficPanel';
import styles from './Rail.module.css';

/*
 * The right column. It is a plain list of panels: to show something new here,
 * write the panel and add it to this list.
 */
const PANELS: ReadonlyArray<{ id: string; title: string; Panel: ComponentType }> = [
  { id: 'traffic', title: 'Traffic', Panel: TrafficPanel },
];

export function Rail() {
  return (
    <div className={styles.rail}>
      {PANELS.map(({ id, title, Panel }) => (
        <section key={id} className={styles.section}>
          <h2 className={styles.title}>{title}</h2>
          <Panel />
        </section>
      ))}
    </div>
  );
}
