import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { GUIDE_PATH } from '@/features/guide/guide';
import logoUrl from '@/assets/kaonic-logo.svg';
import styles from './Auth.module.css';

interface AuthLayoutProps {
  title: string;
  description?: string;
  children: ReactNode;
  /** Shown above the title, e.g. the step indicator of the setup flow. */
  above?: ReactNode;
}

/** The centred card used before the user is signed in. */
export function AuthLayout({ title, description, children, above }: AuthLayoutProps) {
  return (
    <div className={styles.screen}>
      <main className={styles.card}>
        <img className={styles.logo} src={logoUrl} alt="Kaonic" />
        {above}
        <div>
          <h1 className={styles.title}>{title}</h1>
          {description ? <p className={styles.description}>{description}</p> : null}
        </div>
        {children}
        <p className={styles.guideLink}>
          New to Kaonic? <Link to={GUIDE_PATH}>Read the guide</Link>: setting up, pairing nodes, and using the device.
        </p>
      </main>
    </div>
  );
}
