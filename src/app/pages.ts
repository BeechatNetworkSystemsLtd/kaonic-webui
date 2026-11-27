import type { ComponentType } from 'react';
import { Activity, Blocks, BookOpen, ListChecks, Mic, Network, RadioTower, Settings, ShieldCheck, Waypoints, type LucideIcon } from 'lucide-react';

/*
 * The page registry. Navigation and routes are both built from this list, so
 * adding a built-in page is one entry here plus the page component.
 */

export interface PageDef {
  /** Names the page in the menu choice saved on the device. */
  id: string;
  /** Route path under `/`. An empty string is the home page. */
  path: string;
  label: string;
  icon: LucideIcon;
  /** True when the page has pages under it (`/nodes/<id>`); the menu entry then stays lit on those too. */
  hasSubpages?: boolean;
  /** Loaded on first visit, so each page is its own chunk. */
  load: () => Promise<{ default: ComponentType }>;
}

export const PAGES: readonly PageDef[] = [
  { id: 'mesh', path: '', label: 'Mesh', icon: Waypoints, load: () => import('@/features/mesh/MeshPage') },
  { id: 'talk', path: 'talk', label: 'Talk', icon: Mic, load: () => import('@/features/talk/TalkPage') },
  { id: 'nodes', path: 'nodes', label: 'Nodes', icon: ListChecks, hasSubpages: true, load: () => import('@/features/nodes/NodesPage') },
  { id: 'network', path: 'network', label: 'Network', icon: Network, load: () => import('@/features/network/NetworkPage') },
  { id: 'radio', path: 'radio', label: 'Radio', icon: RadioTower, load: () => import('@/features/radio/RadioPage') },
  { id: 'traffic', path: 'traffic', label: 'Traffic', icon: Activity, load: () => import('@/features/traffic/TrafficPage') },
  { id: 'vpn', path: 'vpn', label: 'VPN', icon: ShieldCheck, load: () => import('@/features/vpn/VpnPage') },
  { id: 'plugins', path: 'plugins', label: 'Plugins', icon: Blocks, load: () => import('@/features/plugins/PluginsPage') },
  { id: 'system', path: 'system', label: 'System', icon: Settings, load: () => import('@/features/system/SystemPage') },
  { id: 'guide', path: 'guide', label: 'Guide', icon: BookOpen, load: () => import('@/features/guide/GuidePage') },
];

/** The menu of a fresh device: the everyday pages; the rest are turned on in System. */
export const DEFAULT_SHOWN: readonly string[] = ['mesh', 'talk', 'nodes', 'system', 'guide'];
/** Always in the menu: where the others are turned on. */
export const ALWAYS_SHOWN = 'system';

/** The menu's pages for a saved choice (null: the defaults). Hidden pages still open by their address. */
export function shownPages(shown: readonly string[] | null | undefined): PageDef[] {
  const ids = new Set(shown ?? DEFAULT_SHOWN);
  return PAGES.filter((page) => page.id === ALWAYS_SHOWN || ids.has(page.id));
}

/** Where one node's page lives. */
export const nodePagePath = (nodeId: string) => `/nodes/${nodeId}`;

/** Where a plugin's own page lives inside the UI. */
export const pluginPagePath = (pluginId: string) => `/plugins/${encodeURIComponent(pluginId)}`;
