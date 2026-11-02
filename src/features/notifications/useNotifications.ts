import { nodePagePath } from '@/app/pages';
import { useNetwork, usePeers, useServices } from '@/data/queries';
import { CONSUMER_LABELS, SOURCE_LABELS } from '@/features/network/labels';

export interface Notification {
  id: string;
  title: string;
  detail: string;
  /** The page where the user deals with it. */
  to: string;
  tone: 'accent' | 'warn' | 'danger';
}

/**
 * Things that need the operator's attention, worked out from the state the UI
 * already holds. When the hub gets its own notification feed, replace the body
 * of this hook; the header only depends on the returned list.
 */
export function useNotifications(): Notification[] {
  const peers = usePeers().data ?? [];
  const network = useNetwork().data;
  const services = useServices().data ?? [];

  const provisioning: Notification[] = peers
    .filter((peer) => peer.trust.provisioning?.state === 'failed')
    .map((peer) => ({ id: `provision:${peer.id}`, title: `Could not set up ${peer.codename}`, detail: peer.trust.provisioning!.detail, to: nodePagePath(peer.id), tone: 'danger' }));

  const joining: Notification[] = peers
    .filter((peer) => peer.online && peer.list === 'none' && peer.trust.network === 'unprovisioned' && peer.trust.provisioning === null)
    .map((peer) => ({ id: `join:${peer.id}`, title: `${peer.codename} waits to join`, detail: 'Whitelist it to set it up.', to: nodePagePath(peer.id), tone: 'accent' }));

  const ports: Notification[] = [
    ...(network?.sources ?? []).map((source) => ({ port: source, title: SOURCE_LABELS[source.id].title })),
    ...(network?.consumers ?? []).map((consumer) => ({ port: consumer, title: CONSUMER_LABELS[consumer.id].title })),
  ]
    .filter(({ port }) => port.status === 'waiting')
    .map(({ port, title }) => ({ id: `port:${port.id}`, title: `${title} is not working`, detail: port.detail, to: '/network', tone: 'warn' }));

  const failed: Notification[] = services
    .filter((service) => service.state === 'failed')
    .map((service) => ({ id: `service:${service.unit}`, title: `${service.name} has failed`, detail: service.unit, to: '/system', tone: 'danger' }));

  return [...failed, ...provisioning, ...joining, ...ports];
}
