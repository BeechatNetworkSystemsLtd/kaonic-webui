import { useEffect } from 'react';
import { Link } from 'react-router';
import logoUrl from '@/assets/kaonic-logo.svg';
import { GuideContent } from './GuideContent';
import styles from './Guide.module.css';

/** The guide before signing in: the same content, framed without the app around it. */
export function PublicGuide() {
  useEffect(() => {
    document.title = 'Guide · Kaonic';
  }, []);

  return (
    <div className={styles.publicScreen}>
      <header className={styles.publicHeader}>
        <img src={logoUrl} alt="Kaonic" />
        <Link to="/" className={styles.back}>
          Back to sign in
        </Link>
      </header>
      <main className={styles.publicMain}>
        <h1 className={styles.publicTitle}>Guide</h1>
        <p className={styles.publicLead}>How a Kaonic network works, how nodes are paired, and how to use each page.</p>
        <GuideContent />
      </main>
    </div>
  );
}
