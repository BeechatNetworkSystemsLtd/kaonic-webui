import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { NodeDetails, Peer, VpnGateway, VpnUplink } from '@/api';
import { api, errorMessage } from '@/api';
import { keys, useDevice, useNetwork, useNodesDetails, usePeers, useVpn } from '@/data/queries';
import { shortHash } from '@/lib/format';
import { Button, Dialog, Field, Notice, Select, Status, Switch } from '@/ui';
import styles from './InternetSharing.module.css';

/** "This device" in the choices; every other device is named by its identity hash. */
const HERE = 'here';
const OFF = 'off';
const EVERYTHING = ['0.0.0.0/0'];

type Step = { state: 'waiting' | 'running' | 'done' | 'failed'; message?: string };

/** One device's part as the popup sees it: this device from its own state, others from what they said. */
interface Member {
  id: string;
  name: string;
  online: boolean;
  /** Null until the node has answered (or when it could not be reached). */
  uplink: VpnUplink | null;
  gateway: VpnGateway | null;
  internet: boolean | null;
  error: unknown;
}

const nameOf = (peer: Peer) => (peer.codename ? peer.codename : shortHash(peer.id));

/**
 * Internet sharing for the whole network, from the admin device: one device shares its
 * internet (its gateway), every other device chosen takes internet from it (its uplink).
 * Each change goes to its device over the mesh, one at a time; the list shows how each went.
 */
export function InternetSharingDialog({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const device = useDevice().data;
  const network = useNetwork().data;
  const vpn = useVpn().data;
  const peers = (usePeers().data ?? []).filter((peer) => peer.list === 'whitelist' && !peer.trust.isAdmin);
  const details = useNodesDetails(peers.map((peer) => peer.id), true);

  const selfId = device?.identityHash ?? '';
  const members: Member[] = [
    { id: HERE, name: `This device${device?.codename ? ` (${device.codename})` : ''}`, online: true, uplink: vpn?.uplink ?? null, gateway: vpn?.gateway ?? null, internet: network ? network.activeSource !== null : null, error: null },
    ...peers.map((peer, index): Member => {
      const answer = details[index];
      const data: NodeDetails | undefined = answer?.data;
      return { id: peer.id, name: nameOf(peer), online: peer.online, uplink: data?.sharing?.uplink ?? null, gateway: data?.sharing?.gateway ?? null, internet: data?.sharing?.internet ?? null, error: answer?.error ?? null };
    }),
  ];
  const current = members.find((member) => member.gateway?.enabled)?.id ?? OFF;

  const [source, setSource] = useState<string | null>(null);
  const chosenSource = source ?? current;
  const [using, setUsing] = useState<Record<string, boolean>>({});
  const uses = (member: Member) => using[member.id] ?? (current === OFF || member.uplink?.enabled === true || member.uplink === null);
  const [steps, setSteps] = useState<Record<string, Step>>({});
  const [running, setRunning] = useState(false);

  const peerIdOf = (id: string) => (id === HERE ? selfId : id);
  const setGateway = (id: string, enabled: boolean) => {
    const input = { enabled, egressInterface: null, routes: EVERYTHING };
    return id === HERE ? api.vpn.setGateway(input) : api.nodes.setGateway(id, input);
  };
  const setUplink = (id: string, gateway: string | null) => {
    const input = { enabled: gateway !== null, peerId: gateway === null ? null : peerIdOf(gateway), defaultRoute: true, routes: [] };
    return id === HERE ? api.vpn.setUplink(input) : api.nodes.setUplink(id, input);
  };

  async function apply() {
    setRunning(true);
    const plan = members.filter((member) => member.id === chosenSource || member.uplink?.enabled || member.gateway?.enabled || (chosenSource !== OFF && uses(member)));
    setSteps(Object.fromEntries(plan.map((member) => [member.id, { state: 'waiting' }])));
    const mark = (id: string, step: Step) => setSteps((all) => ({ ...all, [id]: step }));
    // The source first, so the others find a gateway when they turn their uplink on.
    const ordered = [...plan].sort((a, b) => Number(b.id === chosenSource) - Number(a.id === chosenSource));
    for (const member of ordered) {
      mark(member.id, { state: 'running' });
      try {
        if (member.id === chosenSource) {
          if (member.uplink?.enabled) await setUplink(member.id, null);
          await setGateway(member.id, true);
          mark(member.id, { state: 'done', message: 'Shares its internet' });
        } else {
          if (member.gateway?.enabled) await setGateway(member.id, false);
          const take = chosenSource !== OFF && uses(member);
          if (take || member.uplink?.enabled) await setUplink(member.id, take ? chosenSource : null);
          mark(member.id, { state: 'done', message: take ? 'Takes internet over the mesh' : 'No internet from the mesh' });
        }
      } catch (error) {
        mark(member.id, { state: 'failed', message: errorMessage(error) });
      }
    }
    void client.invalidateQueries({ queryKey: keys.vpn });
    void client.invalidateQueries({ queryKey: ['node'] });
    setRunning(false);
  }

  const sourceMember = members.find((member) => member.id === chosenSource);
  const finished = Object.keys(steps).length > 0 && !running;

  return (
    <Dialog title="Internet sharing" onClose={onClose}>
      <p className={styles.lead}>One device shares its internet; the devices you pick take internet from it over the mesh.</p>
      <Field label="Internet comes from" hint={sourceMember && sourceMember.internet === false ? `${sourceMember.name} has no internet of its own right now.` : undefined}>
        {(control) => (
          <Select {...control} value={chosenSource} disabled={running} onChange={(event) => setSource(event.target.value)}>
            <option value={OFF}>Nobody (sharing off)</option>
            {members.map((member) => (
              <option key={member.id} value={member.id} disabled={!member.online}>
                {member.name}
                {member.internet === true ? ' · has internet' : member.internet === false ? ' · no internet' : ''}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <ul className={styles.list}>
        {members.map((member) => {
          const step = steps[member.id];
          const isSource = member.id === chosenSource;
          return (
            <li key={member.id} className={styles.row}>
              <div className={styles.name}>
                <span>{member.name}</span>
                <span className={styles.state}>
                  {step ? (
                    <Status tone={step.state === 'failed' ? 'danger' : step.state === 'done' ? 'ok' : 'neutral'}>{step.state === 'running' ? 'Applying…' : step.state === 'waiting' ? 'Waiting' : step.message}</Status>
                  ) : !member.online ? (
                    'Out of range'
                  ) : member.error ? (
                    'Could not ask it'
                  ) : member.gateway?.enabled ? (
                    'Shares its internet'
                  ) : member.uplink?.enabled ? (
                    member.uplink.active ? 'Takes internet over the mesh' : 'Waits for a gateway'
                  ) : member.uplink === null ? (
                    'Asking…'
                  ) : (
                    'No internet from the mesh'
                  )}
                </span>
              </div>
              {isSource ? (
                <span className={styles.role}>Source</span>
              ) : (
                <Switch
                  label={`${member.name} takes internet over the mesh`}
                  checked={chosenSource !== OFF && uses(member)}
                  disabled={running || chosenSource === OFF || !member.online}
                  onChange={(checked) => setUsing((all) => ({ ...all, [member.id]: checked }))}
                />
              )}
            </li>
          );
        })}
      </ul>

      {chosenSource !== OFF && chosenSource !== HERE && members.find((member) => member.id === HERE)?.uplink === null ? <Notice tone="warn">This device's state is still loading.</Notice> : null}
      <div className={styles.actions}>
        <Button onClick={onClose}>{finished ? 'Close' : 'Cancel'}</Button>
        <Button variant="primary" busy={running} disabled={!device || (chosenSource !== OFF && !sourceMember?.online)} onClick={() => void apply()}>
          {chosenSource === OFF ? 'Turn sharing off' : 'Apply'}
        </Button>
      </div>
    </Dialog>
  );
}
