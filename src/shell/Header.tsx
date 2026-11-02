import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  Activity,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  Bell,
  LogOut,
  Menu,
  Usb,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import type { Battery, NetworkState, PortStatus } from '@/api';
import logoUrl from '@/assets/kaonic-logo.svg';
import { useBattery, useDevice, useLogout, useNetwork } from '@/data/queries';
import { useNotifications } from '@/features/notifications/useNotifications';
import { Button, StatusDot } from '@/ui';
import styles from './Header.module.css';

interface HeaderProps {
  /** Present when the navigation is a drawer. */
  onOpenNav?: () => void;
  /** Present when the right rail is a drawer. */
  onOpenRail?: () => void;
}

/** The bar across the top of every signed-in page: brand, device status at a glance, session. */
export function Header({ onOpenNav, onOpenRail }: HeaderProps) {
  const network = useNetwork().data;
  const battery = useBattery().data;
  const isAdmin = useDevice().data?.isAdmin ?? false;
  const logout = useLogout();

  return (
    <header className={styles.header}>
      {onOpenNav ? (
        <Button variant="ghost" iconOnly aria-label="Open menu" onClick={onOpenNav}>
          <Menu />
        </Button>
      ) : null}
      <Link to="/" className={styles.brand}>
        <img src={logoUrl} alt="Kaonic" />
        {isAdmin ? (
          <span className={styles.admin} title="This device is the Kaonic Admin of its network">
            ADMIN
          </span>
        ) : null}
      </Link>

      <div className={styles.tools}>
        {network ? <StatusIcon to="/network" {...wifiStatus(network)} /> : null}
        {network ? <StatusIcon to="/network" {...usbStatus(network)} /> : null}
        {battery ? <StatusIcon to="/system" {...batteryStatus(battery)} /> : null}
        <Notifications />
        {onOpenRail ? (
          <Button variant="ghost" iconOnly aria-label="Show traffic" onClick={onOpenRail}>
            <Activity />
          </Button>
        ) : null}
        <Button className={styles.signOut} variant="ghost" aria-label="Sign out" busy={logout.isPending} onClick={() => logout.mutate()}>
          <LogOut />
          <span className={styles.signOutText}>Sign out</span>
        </Button>
      </div>
    </header>
  );
}

/* ── status icons ── */

type Level = 'on' | 'idle' | 'problem' | 'off';

interface StatusIconProps {
  icon: LucideIcon;
  /** Full description, used as tooltip and for screen readers. */
  label: string;
  level: Level;
  /** Short text next to the icon, e.g. the battery percentage. */
  text?: string;
  to: string;
}

function StatusIcon({ icon: Icon, label, level, text, to }: StatusIconProps) {
  return (
    <Link to={to} className={styles.status} data-level={level} title={label} aria-label={label}>
      <Icon aria-hidden />
      {text ? <span className="num">{text}</span> : null}
    </Link>
  );
}

/** The worst-to-best order in which several port states collapse into one icon. */
function combine(statuses: PortStatus[]): Level {
  if (statuses.includes('waiting')) return 'problem';
  if (statuses.includes('active')) return 'on';
  if (statuses.includes('standby')) return 'idle';
  return 'off';
}

function wifiStatus(network: NetworkState): Omit<StatusIconProps, 'to'> {
  const client = network.sources.find((source) => source.id === 'wifi_client');
  const hotspot = network.consumers.find((consumer) => consumer.id === 'hotspot');
  const level = combine([client?.status ?? 'off', hotspot?.status ?? 'off']);
  const parts = [
    client?.enabled ? `network ${client.detail}` : null,
    hotspot?.enabled ? `hotspot on, ${hotspot.clients} connected` : null,
  ].filter(Boolean);
  return { icon: level === 'off' ? WifiOff : Wifi, level, label: `Wi-Fi: ${parts.length ? parts.join('; ') : 'off'}` };
}

function usbStatus(network: NetworkState): Omit<StatusIconProps, 'to'> {
  const phone = network.sources.find((source) => source.id === 'usb_phone');
  const computer = network.consumers.find((consumer) => consumer.id === 'usb_computer');
  const inUse = phone?.enabled ? phone : computer?.enabled ? computer : null;
  const role = phone?.enabled ? 'phone internet' : 'computer';
  return { icon: Usb, level: combine([inUse?.status ?? 'off']), label: inUse ? `USB: ${role}. ${inUse.detail}` : 'USB: off' };
}

function batteryStatus(battery: Battery): Omit<StatusIconProps, 'to'> {
  const { percent, charging } = battery;
  const icon = charging ? BatteryCharging : percent <= 10 ? BatteryWarning : percent <= 35 ? BatteryLow : percent <= 70 ? BatteryMedium : BatteryFull;
  return {
    icon,
    level: !charging && percent <= 10 ? 'problem' : 'on',
    text: `${percent}%`,
    label: `Battery: ${percent}%${charging ? ', charging' : ''}`,
  };
}

/* ── notifications ── */

function Notifications() {
  const items = useNotifications();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => !root.current?.contains(event.target as Node) && setOpen(false);
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = items.length === 0 ? 'Notifications: none' : items.length === 1 ? 'Notifications: 1 new' : `Notifications: ${items.length} new`;

  return (
    <div ref={root} className={styles.notifications}>
      <Button variant="ghost" iconOnly aria-label={label} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
        <Bell />
        {items.length > 0 ? <span className={`${styles.count} num`} aria-hidden>{items.length > 9 ? '9+' : items.length}</span> : null}
      </Button>
      {open ? (
        <Popover>
          {items.length === 0 ? (
            <p className={styles.empty}>Nothing needs your attention.</p>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <Link to={item.to} className={styles.item} onClick={() => setOpen(false)}>
                    <StatusDot tone={item.tone} />
                    <span>
                      <span className={styles.itemTitle}>{item.title}</span>
                      <span className={styles.itemDetail}>{item.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Popover>
      ) : null}
    </div>
  );
}

function Popover({ children }: { children: ReactNode }) {
  return (
    <div className={styles.popover} role="group" aria-label="Notifications">
      <p className={styles.popoverTitle}>Notifications</p>
      {children}
    </div>
  );
}
