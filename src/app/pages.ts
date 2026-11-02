import type { ComponentType } from 'react';
import { Activity, Blocks, BookOpen, ListChecks, Mic, Network, RadioTower, Settings, ShieldCheck, Waypoints, type LucideIcon } from 'lucide-react';

/*
 * The page registry. Navigation and routes are both built from this list, so
 * adding a built-in page is one entry here plus the page component.
 */

export interface PageDef {
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
  { path: '', label: 'Mesh', icon: Waypoints, load: () => import('@/features/mesh/MeshPage') },
  { path: 'talk', label: 'Talk', icon: Mic, load: () => import('@/features/talk/TalkPage') },
  { path: 'nodes', label: 'Nodes', icon: ListChecks, hasSubpages: true, load: () => import('@/features/nodes/NodesPage') },
  { path: 'network', label: 'Network', icon: Network, load: () => import('@/features/network/NetworkPage') },
  { path: 'radio', label: 'Radio', icon: RadioTower, load: () => import('@/features/radio/RadioPage') },
  { path: 'traffic', label: 'Traffic', icon: Activity, load: () => import('@/features/traffic/TrafficPage') },
  { path: 'vpn', label: 'VPN', icon: ShieldCheck, load: () => import('@/features/vpn/VpnPage') },
  { path: 'plugins', label: 'Plugins', icon: Blocks, load: () => import('@/features/plugins/PluginsPage') },
  { path: 'system', label: 'System', icon: Settings, load: () => import('@/features/system/SystemPage') },
  { path: 'guide', label: 'Guide', icon: BookOpen, load: () => import('@/features/guide/GuidePage') },
];

/** Where one node's page lives. */
export const nodePagePath = (nodeId: string) => `/nodes/${nodeId}`;

/** Where a plugin's own page lives inside the UI. */
export const pluginPagePath = (pluginId: string) => `/plugins/${encodeURIComponent(pluginId)}`;
