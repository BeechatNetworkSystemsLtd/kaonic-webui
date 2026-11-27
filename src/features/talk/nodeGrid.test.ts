import { describe, expect, it } from 'vitest';
import type { Peer, PttBurst, PttTalker } from '@/api';
import { lastTalked, packetRates, signalQuality, talkerPrefix, talkTiles } from './nodeGrid';

const peer = (id: string, codename: string, patch: Partial<Peer> = {}): Peer =>
  ({
    id,
    codename,
    tag: '',
    online: true,
    firstSeenTs: 0,
    lastSeenTs: 0,
    list: 'whitelist',
    version: '1.0.0',
    hops: 1,
    viaId: null,
    rssi: null,
    rttMs: null,
    tunnelIp: null,
    trust: { network: 'ours', isAdmin: false, provisioning: null },
    link: { state: 'active', detail: null },
    ...patch,
  }) as Peer;

const talker = (id: string, local = false): PttTalker => ({ id, codename: '', isAdmin: false, local, source: local ? 'browser' : null, hops: local ? null : 0 });

const RIDGE = 'f6a2d6196f686da0e005c701f1d484fb';
const GATE = 'c2b3d952f91803b4890804e0aa16d84e';
const ADMIN = 'd2ba88c8711e4a6b83ec55f838f09f9b';
const SELF = { id: '7a5c0e11aa22bb33cc44dd55ee66ff77', codename: 'kaonic00', isAdmin: false };

describe('talk tiles', () => {
  const peers = [
    peer(RIDGE, 'bench001'),
    peer(GATE, 'bench002'),
    peer(ADMIN, 'benchap1', { trust: { network: 'ours', isAdmin: true, provisioning: null } }),
    peer('11112222333344445555666677778888', 'stranger', { list: 'none', trust: { network: 'unknown', isAdmin: false, provisioning: null } }),
  ];

  it('lists this device first, then the admin, then our network by name, and leaves strangers out', () => {
    const tiles = talkTiles(peers, SELF, null, new Map());
    expect(tiles.map((tile) => tile.codename)).toEqual(['kaonic00', 'benchap1', 'bench001', 'bench002']);
    expect(tiles[0]!.self).toBe(true);
    expect(tiles[1]!.isAdmin).toBe(true);
  });

  it('matches a talker by the 4-byte prefix voice packets carry', () => {
    // The hub pads the rest of an unknown talker's id with zeros.
    const tiles = talkTiles(peers, SELF, talker(`${GATE.slice(0, 8)}000000000000000000000000`), new Map());
    expect(tiles.filter((tile) => tile.talking).map((tile) => tile.codename)).toEqual(['bench002']);
  });

  it('highlights this device when it talks, and nobody else', () => {
    const tiles = talkTiles(peers, SELF, talker(SELF.id, true), new Map());
    expect(tiles.filter((tile) => tile.talking).map((tile) => tile.codename)).toEqual(['kaonic00']);
  });

  it('remembers when each node last talked', () => {
    const burst = { talker: talker(RIDGE), startedTs: 1000, durationMs: 2500, frames: 125, lostFrames: 0, hops: 0, ended: 'released' } as PttBurst;
    const talked = lastTalked(new Map(), [burst], talker(ADMIN), 9000);
    expect(talked.get(talkerPrefix(RIDGE))).toBe(3500);
    expect(talked.get(talkerPrefix(ADMIN))).toBe(9000);
    const tiles = talkTiles(peers, SELF, null, talked);
    expect(tiles.find((tile) => tile.id === RIDGE)!.lastTalkedTs).toBe(3500);
    expect(tiles.find((tile) => tile.id === GATE)!.lastTalkedTs).toBeNull();
  });

  it('puts a signal in bars and words', () => {
    expect(signalQuality(-60)).toEqual({ bars: 4, label: 'Excellent' });
    expect(signalQuality(-85)).toEqual({ bars: 3, label: 'Good' });
    expect(signalQuality(-90)).toEqual({ bars: 2, label: 'Fair' });
    expect(signalQuality(-100)).toEqual({ bars: 1, label: 'Weak' });
    expect(signalQuality(-112)).toEqual({ bars: 0, label: 'Poor' });
  });

  it('reads packet rates over the last few seconds', () => {
    const samples = [
      { ts: 0, rx: 0, tx: 0 },
      { ts: 2000, rx: 20, tx: 4 },
      { ts: 4000, rx: 40, tx: 4 },
    ];
    expect(packetRates(samples, 4000)).toEqual({ rx: 10, tx: 1 });
    expect(packetRates(samples, 20_000)).toEqual({ rx: 0, tx: 0 });
    expect(packetRates([], 0)).toEqual({ rx: 0, tx: 0 });
  });
});

