import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { X } from 'lucide-react';
import { useAutoClock, useLiveSync } from '@/data/queries';
import { BREAKPOINTS, useMediaQuery } from '@/lib/useMediaQuery';
import { Button } from '@/ui';
import { Header } from './Header';
import { Rail } from './Rail';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import styles from './AppShell.module.css';

/** An open drawer remembers the page it was opened on, so navigating away closes it. */
type Drawer = { side: 'nav' | 'rail'; path: string } | null;

/**
 * The signed-in layout: a header across the top, navigation and device on the
 * left, the page in the middle, live charts on the right, and a status bar
 * along the bottom.
 *
 * On narrower screens the side columns become drawers, opened from the header:
 * the right rail below 1280px, the navigation below 860px.
 */
export function AppShell({ children }: { children: ReactNode }) {
  useLiveSync();
  useAutoClock();
  const navDocked = useMediaQuery(BREAKPOINTS.nav);
  const railDocked = useMediaQuery(BREAKPOINTS.rail);
  const { pathname } = useLocation();
  const [drawer, setDrawer] = useState<Drawer>(null);
  const openSide = drawer?.path === pathname ? drawer.side : null;
  const open = (side: 'nav' | 'rail') => setDrawer({ side, path: pathname });

  useEffect(() => {
    if (!openSide) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setDrawer(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSide]);

  const navOpen = !navDocked && openSide === 'nav';
  const railOpen = !railDocked && openSide === 'rail';

  return (
    <div className={styles.shell}>
      <Header onOpenNav={navDocked ? undefined : () => open('nav')} onOpenRail={railDocked ? undefined : () => open('rail')} />

      <aside className={styles.nav} data-open={navOpen} inert={!navDocked && !navOpen}>
        {!navDocked ? <CloseButton label="Close menu" onClick={() => setDrawer(null)} /> : null}
        <Sidebar />
      </aside>

      <main className={styles.main}>{children}</main>

      <aside className={styles.rail} data-open={railOpen} inert={!railDocked && !railOpen} aria-label="Live traffic">
        {!railDocked ? <CloseButton label="Close traffic" onClick={() => setDrawer(null)} /> : null}
        {/* Charts only listen to the hub while the rail is on screen. */}
        {railDocked || railOpen ? <Rail /> : null}
      </aside>

      {navOpen || railOpen ? <div className={styles.backdrop} onClick={() => setDrawer(null)} /> : null}

      <StatusBar />
    </div>
  );
}

function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button className={styles.close} variant="ghost" iconOnly aria-label={label} onClick={onClick}>
      <X />
    </Button>
  );
}
