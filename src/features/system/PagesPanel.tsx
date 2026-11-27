import { ALWAYS_SHOWN, DEFAULT_SHOWN, PAGES, shownPages } from '@/app/pages';
import { errorMessage } from '@/api';
import { useSetUiPages, useUiPages } from '@/data/queries';
import { Button, LoadError, Notice, Panel, Skeleton, Switch } from '@/ui';
import styles from './SystemPage.module.css';

/** Which pages the menu shows, for every browser of this device. A fresh device shows the everyday ones. */
export function PagesPanel({ admin }: { admin: boolean }) {
  const saved = useUiPages();
  const save = useSetUiPages();
  const shown = new Set(shownPages(saved.data).map((page) => page.id));

  function toggle(id: string, on: boolean) {
    const next = PAGES.map((page) => page.id).filter((page) => (page === id ? on : shown.has(page)));
    save.mutate(next);
  }

  const isDefault = saved.data == null;
  return (
    <Panel
      title="Pages"
      actions={
        admin && !isDefault ? (
          <Button size="small" variant="ghost" onClick={() => save.mutate(null)}>
            Reset
          </Button>
        ) : null
      }
    >
      {saved.isPending ? (
        <Skeleton lines={4} />
      ) : saved.isError ? (
        <LoadError error={saved.error} onRetry={() => void saved.refetch()} />
      ) : (
        <div className={styles.maintenance}>
          <p className={styles.unit}>
            The pages in the menu. A hidden page still opens from its address. {admin ? '' : 'Only the admin can change these.'}
          </p>
          <ul className={styles.pageList}>
            {PAGES.map(({ id, label, icon: Icon }) => (
              <li key={id} className={styles.pageRow}>
                <Icon aria-hidden className={styles.pageIcon} />
                <span className={styles.serviceName}>{label}</span>
                {DEFAULT_SHOWN.includes(id) ? null : <span className={styles.unit}>Advanced</span>}
                <Switch
                  label={`Show ${label}`}
                  checked={shown.has(id)}
                  disabled={!admin || id === ALWAYS_SHOWN || save.isPending}
                  onChange={(on) => toggle(id, on)}
                />
              </li>
            ))}
          </ul>
          {save.isError ? <Notice tone="danger">{errorMessage(save.error)}</Notice> : null}
        </div>
      )}
    </Panel>
  );
}
