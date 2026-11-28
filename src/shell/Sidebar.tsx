import { NavLink } from 'react-router';
import { Puzzle } from 'lucide-react';
import { pluginPagePath, shownPages } from '@/app/pages';
import { useDevice, usePlugins, useUiPages } from '@/data/queries';
import { formatDuration, shortHash } from '@/lib/format';
import { KeyValues, Skeleton } from '@/ui';
import styles from './Sidebar.module.css';

const linkClass = ({ isActive }: { isActive: boolean }) => (isActive ? `${styles.link} ${styles.active}` : styles.link);

export function Sidebar() {
  const pages = shownPages(useUiPages().data);
  return (
    <div className={styles.sidebar}>
      <nav className={styles.nav} aria-label="Main">
        <ul>
          {pages.map(({ path, label, icon: Icon, hasSubpages }) => (
            <li key={path}>
              <NavLink to={`/${path}`} end={!hasSubpages} className={linkClass}>
                <Icon aria-hidden />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
        <PluginLinks />
      </nav>
      <DeviceCard />
    </div>
  );
}

/** Running plugins that bring their own page get a place in the menu. */
function PluginLinks() {
  const plugins = usePlugins();
  const withPage = plugins.data?.filter((plugin) => plugin.running && plugin.appUrl) ?? [];
  if (withPage.length === 0) return null;
  return (
    <>
      <h2 className={styles.group}>Plugin pages</h2>
      <ul>
        {withPage.map((plugin) => (
          <li key={plugin.id}>
            <NavLink to={pluginPagePath(plugin.id)} className={linkClass}>
              <Puzzle aria-hidden />
              {plugin.name}
            </NavLink>
          </li>
        ))}
      </ul>
    </>
  );
}

function DeviceCard() {
  const device = useDevice();

  return (
    <section className={styles.device} aria-label="This device">
      {device.data ? (
        <>
          <p className={styles.codename}>{device.data.codename}</p>
          <p className={styles.model}>{device.data.model}</p>
          <KeyValues
            rows={[
              ['Serial', <span className={`${styles.serial} mono`}>{device.data.serial}</span>],
              ['Identity', <span className="mono" title={device.data.identityHash}>{shortHash(device.data.identityHash)}</span>],
              ['Uptime', <span className="num">{formatDuration(device.data.uptimeSecs)}</span>],
              ['Hub', device.data.versions.hub],
            ]}
          />
        </>
      ) : (
        <Skeleton lines={4} />
      )}
    </section>
  );
}
