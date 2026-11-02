import { describe, expect, it, vi } from 'vitest';
import { createMockApi, memoryStore } from './mockApi';

const fresh = () => createMockApi({ latencyMs: 0, storage: memoryStore() });
const setup = { mode: 'member', password: 'correct-horse', codename: 'kaon7qjt' } as const;
const adminSetup = { ...setup, mode: 'admin', seedPassword: 'long enough seed phrase' } as const;

describe('mock hub', () => {
  it('starts unprovisioned and refuses protected calls', async () => {
    const api = fresh();
    expect(await api.auth.state()).toEqual({ setupRequired: true, authenticated: false, role: null });
    await expect(api.device.get()).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('validates the provisioning input per field', async () => {
    const api = fresh();
    await expect(api.auth.setup({ ...setup, password: 'short', codename: 'Bad' })).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { password: expect.any(String), codename: expect.any(String) },
    });
  });

  it('derives the same admin identity from the same seed password, so a key can be recovered', async () => {
    const first = fresh();
    const derived = await first.auth.deriveIdentity(adminSetup.seedPassword);
    expect(derived).toMatch(/^[0-9a-f]{32}$/);
    await expect(first.auth.deriveIdentity('short')).rejects.toMatchObject({ code: 'validation_failed', fields: { seedPassword: expect.any(String) } });

    await first.auth.setup(adminSetup);
    expect((await first.device.get()).identityHash).toBe(derived);
    await expect(first.auth.deriveIdentity(adminSetup.seedPassword)).rejects.toMatchObject({ code: 'conflict' });

    const recovered = fresh();
    await recovered.auth.setup(adminSetup);
    expect((await recovered.device.get()).identityHash).toBe(derived);
  });

  it('keeps the boot identity for a member, and makes a new one after a factory reset', async () => {
    const api = fresh();
    const boot = await api.auth.bootIdentity();
    await api.auth.setup(setup);
    expect((await api.device.get()).identityHash).toBe(boot);

    await api.device.factoryReset(setup.password);
    expect(await api.auth.bootIdentity()).not.toBe(boot);
  });

  it('provisions, signs out and signs back in', async () => {
    const api = fresh();
    await api.auth.setup(setup);
    expect((await api.auth.state()).authenticated).toBe(true);
    expect((await api.device.get()).codename).toBe('kaon7qjt');

    await api.auth.logout();
    expect(await api.auth.state()).toEqual({ setupRequired: false, authenticated: false, role: null });
    await expect(api.auth.login('wrong-password')).rejects.toMatchObject({ code: 'unauthenticated' });
    await api.auth.login(setup.password);
    expect((await api.auth.state()).authenticated).toBe(true);
  });

  it('keeps the USB port to one role and prevents a mesh internet loop', async () => {
    const api = fresh();
    await api.auth.setup(setup);

    let state = await api.network.setSource('usb_phone', true);
    expect(state.consumers.find((c) => c.id === 'usb_computer')?.enabled).toBe(false);

    state = await api.network.setConsumer('mesh_peers', true);
    expect(state.consumers.find((c) => c.id === 'mesh_peers')?.status).toBe('waiting');

    state = await api.network.setSource('mesh_gateway', true);
    expect(state.consumers.find((c) => c.id === 'mesh_peers')?.enabled).toBe(false);
    expect(state.activeSource).toBe('mesh_gateway');
  });

  it('installs a plugin package, updates it from a newer one, and refuses other files', async () => {
    const api = fresh();
    await api.auth.setup(setup);
    const before = (await api.plugins.list()).length;

    const first = await api.plugins.install(new File(['zip'], 'weather-station-1.0.0.zip'), 'password-1');
    expect(first).toMatchObject({ action: 'installed', plugin: { id: 'weather-station', running: false, official: false } });
    expect(await api.plugins.list()).toHaveLength(before + 1);

    const again = await api.plugins.install(new File(['zip'], 'weather-station-1.1.0.zip'), 'password-1');
    expect(again.action).toBe('updated');
    expect(again.plugin.version).not.toBe(first.plugin.version);
    expect(await api.plugins.list()).toHaveLength(before + 1);

    await expect(api.plugins.install(new File(['x'], 'notes.txt'), 'password-1')).rejects.toMatchObject({ code: 'validation_failed', fields: { file: expect.any(String) } });

    await api.plugins.remove('weather-station');
    expect(await api.plugins.list()).toHaveLength(before);
  });

  it('returns to provisioning after a factory reset', async () => {
    const api = fresh();
    await api.auth.setup(setup);
    // A wrong password is a form error, never the end of the session.
    await expect(api.device.factoryReset('nope')).rejects.toMatchObject({ code: 'validation_failed', fields: { password: expect.any(String) } });
    expect((await api.auth.state()).authenticated).toBe(true);
    await api.device.factoryReset(setup.password);
    expect((await api.auth.state()).setupRequired).toBe(true);
  });

  it('manages whitelisted nodes only, one job per node, and applies the change when the job is done', async () => {
    vi.useFakeTimers();
    try {
      const api = fresh();
      await api.auth.setup(adminSetup);
      const peers = await api.peers.list();
      const trusted = peers.find((peer) => peer.list === 'whitelist' && peer.online)!;
      const stranger = peers.find((peer) => peer.list === 'none')!;
      const release = await api.nodes.release();
      expect(trusted.version).not.toBe(release.version);

      await expect(api.nodes.updateSoftware([stranger.id])).rejects.toMatchObject({ code: 'forbidden' });

      const [job] = await api.nodes.updateSoftware([trusted.id]);
      expect(job).toMatchObject({ nodeId: trusted.id, kind: 'update', state: 'queued' });

      // Long enough for the slowest node of the mock to finish.
      await vi.advanceTimersByTimeAsync(120_000);
      expect((await api.nodes.jobs())[0]).toMatchObject({ state: 'done', progress: 1 });
      expect((await api.peers.list()).find((peer) => peer.id === trusted.id)!.version).toBe(release.version);
      expect((await api.nodes.details(trusted.id)).version).toBe(release.version);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails a job on a node that is out of range instead of leaving it hanging', async () => {
    vi.useFakeTimers();
    try {
      const api = fresh();
      await api.auth.setup(adminSetup);
      const away = (await api.peers.list()).find((peer) => peer.list === 'whitelist' && !peer.online)!;
      await api.nodes.restart([away.id]);
      await vi.advanceTimersByTimeAsync(2000);
      expect((await api.nodes.jobs())[0]).toMatchObject({ state: 'failed', detail: 'Could not reach the node' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets only the admin device change the whitelist or manage nodes', async () => {
    const api = fresh();
    await api.auth.setup(setup);
    const peers = await api.peers.list();
    const trusted = peers.find((peer) => peer.list === 'whitelist')!;
    const stranger = peers.find((peer) => peer.list === 'none' && peer.trust.network === 'unknown')!;

    await expect(api.peers.setList(stranger.id, 'whitelist')).rejects.toMatchObject({ code: 'forbidden', reason: 'not_admin_device' });
    await expect(api.peers.setList(trusted.id, 'none')).rejects.toMatchObject({ code: 'forbidden', reason: 'not_admin_device' });
    await expect(api.nodes.restart([trusted.id])).rejects.toMatchObject({ code: 'forbidden' });
    // A member may still refuse a node it does not trust.
    expect((await api.peers.setList(stranger.id, 'blacklist')).list).toBe('blacklist');
  });

  it('provisions a node that waits to join before whitelisting it, and refuses another admin\'s node', async () => {
    vi.useFakeTimers();
    try {
      const api = fresh();
      await api.auth.setup(adminSetup);
      const peers = await api.peers.list();
      const waiting = peers.find((peer) => peer.online && peer.trust.network === 'unprovisioned')!;
      const foreign = peers.find((peer) => peer.trust.network === 'other')!;

      const started = await api.peers.setList(waiting.id, 'whitelist');
      expect(started).toMatchObject({ list: 'none', trust: { provisioning: { state: 'running' } } });

      await vi.advanceTimersByTimeAsync(5000);
      const joined = (await api.peers.list()).find((peer) => peer.id === waiting.id)!;
      expect(joined).toMatchObject({ list: 'whitelist', trust: { network: 'ours', provisioning: null }, link: { state: 'active' } });

      await expect(api.peers.setList(foreign.id, 'whitelist')).rejects.toMatchObject({ code: 'conflict', reason: 'foreign_node' });

      // Taking it off the whitelist revokes it: its link goes.
      const revoked = await api.peers.setList(waiting.id, 'blacklist');
      expect(revoked).toMatchObject({ list: 'blacklist', link: { state: 'none' }, tunnelIp: null });
    } finally {
      vi.useRealTimers();
    }
  });
});
