import { useEffect, type ReactNode } from 'react';
import styles from './Page.module.css';

interface PageProps {
  title: string;
  /** One sentence under the title saying what the page is for. */
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** The frame every page in the middle column uses: heading, then content. */
export function Page({ title, description, actions, children }: PageProps) {
  useEffect(() => {
    document.title = `${title} · Kaonic`;
  }, [title]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          {description ? <p className={styles.description}>{description}</p> : null}
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}

/** A responsive grid for panels: as many equal columns as fit. */
export function PanelGrid({ children, min = 280 }: { children: ReactNode; min?: number }) {
  return (
    <div className={styles.grid} style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))` }}>
      {children}
    </div>
  );
}
