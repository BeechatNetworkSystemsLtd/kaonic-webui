import { useMemo, useState } from 'react';
import type { Plugin } from '@/api';
import { useSoftwareHistory } from '@/data/queries';
import { EmptyState, LoadError, Panel, Select, Skeleton, Status } from '@/ui';
import { actionText, formatWhen, HUB_ID, INSTALLER_ID, outcomeOf, subjectName, versionsText } from './software';
import styles from './HistoryPanel.module.css';

/** What the installer did to plugins, the hub and itself, newest first. Admin only. */
export function HistoryPanel({ plugins }: { plugins: Plugin[] }) {
  const [filter, setFilter] = useState('');
  const all = useSoftwareHistory(null);
  const filtered = useSoftwareHistory(filter, filter !== '');
  const history = filter ? filtered : all;
  const names = useMemo(() => new Map(plugins.map((plugin) => [plugin.id, plugin.name])), [plugins]);

  // Plugins installed now, and those only the history remembers (removed since).
  const ids = useMemo(() => {
    const found = new Set(plugins.map((plugin) => plugin.id));
    for (const event of all.data ?? []) if (event.id !== HUB_ID && event.id !== INSTALLER_ID) found.add(event.id);
    return [...found].sort((a, b) => subjectName(a, names).localeCompare(subjectName(b, names)));
  }, [plugins, all.data, names]);

  const picker = (
    <Select aria-label="Show the history of" className={styles.filter} value={filter} onChange={(event) => setFilter(event.target.value)}>
      <option value="">Everything</option>
      <option value={HUB_ID}>Hub</option>
      <option value={INSTALLER_ID}>Installer</option>
      {ids.map((id) => (
        <option key={id} value={id}>
          {subjectName(id, names)}
        </option>
      ))}
    </Select>
  );

  return (
    <Panel title="History" actions={picker} flush>
      {history.isPending ? (
        <div className={styles.pad}>
          <Skeleton lines={4} />
        </div>
      ) : history.isError ? (
        <div className={styles.pad}>
          <LoadError error={history.error} onRetry={() => void history.refetch()} />
        </div>
      ) : history.data.length === 0 ? (
        <EmptyState title="Nothing yet">Installs, updates and rollbacks show here.</EmptyState>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>Action</th>
                <th>Version</th>
                <th>Outcome</th>
                <th>Who</th>
              </tr>
            </thead>
            <tbody>
              {history.data.map((event, index) => {
                const outcome = outcomeOf(event);
                return (
                  <tr key={`${event.time}-${event.id}-${index}`}>
                    <td className="num">{formatWhen(event.time)}</td>
                    <td>{subjectName(event.id, names)}</td>
                    <td>
                      {actionText(event)}
                      {event.signed ? null : event.to ? <span className={styles.unsigned}> unsigned</span> : null}
                    </td>
                    <td className="num">{versionsText(event) || '–'}</td>
                    <td className={styles.outcome}>
                      <Status tone={outcome.tone}>{outcome.text}</Status>
                      {event.message ? <p className={styles.message}>{event.message}</p> : null}
                    </td>
                    <td className={styles.actor}>{event.actor ?? '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
