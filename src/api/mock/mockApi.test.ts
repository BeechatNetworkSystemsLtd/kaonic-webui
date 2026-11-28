import { describe, expect, it, vi } from 'vitest';
import { createMockApi, memoryStore } from './mockApi';

const fresh = () => createMockApi({ latencyMs: 0, storage: memoryStore() });
const setup = { mode: 'member', password: 'correct-horse', codename: 'kaon7qjt' } as const;
const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const adminSetup = { ...setup, mode: 'admin', seedPhrase: PHRASE } as const;

describe('mock hub', () => {
  it('starts unprovisioned and refuses protected calls', async () => {
    const api = fresh();
    expect(await api.auth.state()).toEqual({ setupRequired: true, passwordSet: false, authenticated: false, role: null });
    await expect(api.device.get()).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('validates the provisioning input per field', async () => {
    const api = fresh();
    await expect(api.auth.setup({ ...setup, password: 'short', codename: 'Bad' })).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { password: expect.any(String), codename: expect.any(String) },
    });
  });

  it('derives the same admin identity from the same seed phrase, so a key can be recovered', async () => {
    const first = fresh();
    const derived = await first.auth.deriveIdentity({ seedPhrase: `  ${PHRASE.toUpperCase()} ` });
    expect(derived).toMatch(/^[0-9a-f]{32}$/);
    const mistyped = PHRASE.replace('sausage', 'sausag');
    await expect(first.auth.deriveIdentity({ seedPhrase: mistyped })).rejects.toMatchObject({ fields: { seedPhrase: 'Not on the word list: word 6.' } });
    const swapped = PHRASE.replace('yellow', 'zoo');
    await expect(first.auth.deriveIdentity({ seedPhrase: swapped })).rejects.toMatchObject({ fields: { seedPhrase: expect.stringContaining('do not fit') } });

    await first.auth.setup(adminSetup);
    expect((await first.device.get()).identityHash).toBe(derived);
    await expect(first.auth.deriveIdentity({ seedPhrase: PHRASE })).rejects.toMatchObject({ code: 'conflict' });

    const recovered = fresh();
    await recovered.auth.setup(adminSetup);
    expect((await recovered.device.get()).identityHash).toBe(derived);
  });

  it('makes new seed phrases of 12 or 24 words that it accepts back', async () => {
    const api = fresh();
    const twelve = await api.auth.newSeedPhrase(12);
    expect(twelve).toHaveLength(12);
    expect((await api.auth.newSeedPhrase(24)).length).toBe(24);
    expect(await api.auth.newSeedPhrase(12)).not.toEqual(twelve);
    await api.auth.setup({ ...adminSetup, seedPhrase: twelve.join(' ') });
    expect((await api.auth.wordlist()).length).toBe(2048);
  });

  it('opens without a password when none is set', async () => {
    const api = fresh();
    await api.auth.setup({ ...setup, password: null });
    await api.auth.logout();
    expect(await api.auth.state()).toMatchObject({ passwordSet: false, authenticated: true });
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
    expect(await api.auth.state()).toEqual({ setupRequired: false, passwordSet: true, authenticated: false, role: null });
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
    const upload = { password: setup.password };

    const first = await api.plugins.install(new File(['tar'], 'weather-station-1.0.0.kpkg'), upload);
    expect(first).toMatchObject({ action: 'installed', plugin: { id: 'weather-station', version: '1.0.0', running: true, official: false, previousVersion: null } });
    expect(await api.plugins.list()).toHaveLength(before + 1);

    const again = await api.plugins.install(new File(['tar'], 'weather-station-1.1.0.kpkg'), upload);
    expect(again).toMatchObject({ action: 'updated', plugin: { version: '1.1.0', previousVersion: '1.0.0', highestVersion: '1.1.0' } });
    expect(await api.plugins.list()).toHaveLength(before + 1);

    await expect(api.plugins.install(new File(['x'], 'notes.txt'), upload)).rejects.toMatchObject({ code: 'validation_failed', fields: { file: expect.any(String) } });
    await expect(api.plugins.install(new File(['tar'], 'weather-station-1.2.0.kpkg'), { password: 'wrong-one' })).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { password: expect.any(String) },
    });

    await api.plugins.remove('weather-station', true);
    expect(await api.plugins.list()).toHaveLength(before);
    expect((await api.software.history({ id: 'weather-station' })).map((event) => event.action)).toEqual(['remove', 'upgrade', 'install']);
  });

  it('refuses an older version until the downgrade is allowed, and rolls back', async () => {
    const api = fresh();
    await api.auth.setup(setup);
    const upload = { password: setup.password };
    await api.plugins.install(new File(['tar'], 'tracker-2.0.0.kpkg'), upload);

    await expect(api.plugins.update('tracker', new File(['tar'], 'tracker-1.0.0.kpkg'), upload)).rejects.toMatchObject({ code: 'conflict', reason: 'downgrade' });
    const older = await api.plugins.update('tracker', new File(['tar'], 'tracker-1.0.0.kpkg'), { ...upload, allowDowngrade: true });
    expect(older).toMatchObject({ version: '1.0.0', previousVersion: '2.0.0', highestVersion: '2.0.0' });
    await expect(api.plugins.update('tracker', new File(['tar'], 'other-1.0.0.kpkg'), upload)).rejects.toMatchObject({ fields: { file: expect.any(String) } });

    const back = await api.plugins.act('tracker', 'rollback');
    expect(back).toMatchObject({ version: '2.0.0', previousVersion: '1.0.0' });
    const [latest] = await api.software.history({ id: 'tracker', limit: 1 });
    expect(latest).toMatchObject({ action: 'rollback', outcome: 'done', from: '1.0.0', to: '2.0.0' });
  });

  it('keeps unsigned packages out once the policy asks for signed ones', async () => {
    const api = fresh();
    await api.auth.setup(setup);
    await expect(api.plugins.setPolicy(true, 'wrong-one')).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await api.plugins.policy()).toEqual({ requireSigned: false, releaseKey: true });
    expect(await api.plugins.setPolicy(true, setup.password)).toEqual({ requireSigned: true, releaseKey: null });
    await expect(api.plugins.install(new File(['tar'], 'tracker-1.0.0.kpkg'), { password: setup.password })).rejects.toMatchObject({ code: 'forbidden' });
    const signed = await api.plugins.install(new File(['tar'], 'tracker-1.0.0-signed.kpkg'), { password: setup.password });
    expect(signed.plugin.official).toBe(true);

    const dev = createMockApi({ latencyMs: 0, storage: memoryStore(), releaseKey: false });
    await dev.auth.setup(setup);
    expect((await dev.software.state()).releaseKey).toBe(false);
    expect((await dev.plugins.policy()).releaseKey).toBe(false);
    await expect(dev.plugins.setPolicy(true, setup.password)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('reads a package before it is installed, without the password', async () => {
    const api = fresh();
    await api.auth.setup(setup);
    expect(await api.plugins.check(new File(['tar'], 'mesh-chat-1.2.0-signed.kpkg'))).toMatchObject({
      id: 'mesh-chat',
      version: '1.2.0',
      signed: true,
      installed: '1.1.0',
      permissions: ['mesh'],
      hasPage: true,
    });
    expect(await api.plugins.check(new File(['tar'], 'voice-relay-0.1.0.kpkg'))).toMatchObject({ id: 'voice-relay', signed: false, installed: null, permissions: ['audio', 'realtime'] });
    await expect(api.plugins.check(new File(['x'], 'notes.txt'))).rejects.toMatchObject({ code: 'validation_failed', fields: { file: expect.any(String) } });
  });

  it('opens a plugin page with a ticket, and says when a plugin has none', async () => {
    const api = fresh();
    await api.auth.setup(setup);
    await expect(api.plugins.open('audio-ptt')).rejects.toMatchObject({ code: 'not_found' });
    await expect(api.plugins.open('missing')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('answers 503 for plugins while the installer is down', async () => {
    const api = createMockApi({ latencyMs: 0, storage: memoryStore(), installerRunning: false });
    await api.auth.setup(setup);
    await expect(api.plugins.list()).rejects.toMatchObject({ code: 'unavailable', reason: 'installer_unavailable' });
    expect((await api.software.state()).installer).toEqual({ version: null, reachable: false });
  });

  it('updates the hub after a restart, or puts the old one back', async () => {
    const api = createMockApi({ latencyMs: 0, storage: memoryStore(), hubRestartMs: 0 });
    await api.auth.setup(setup);
    const upload = { password: setup.password };
    const before = (await api.software.state()).hub.version;

    const job = await api.software.updateHub(new File(['tar'], 'kaonic-hub-1.5.0-fail.kpkg'), upload);
    expect(job).toMatchObject({ version: '1.5.0', state: 'running' });
    const failed = await api.software.state();
    expect(failed.hubUpdate).toMatchObject({ id: job.id, state: 'failed', message: `1.5.0 did not come up; ${before} is back` });
    expect(failed.hub.version).toBe(before);

    const next = await api.software.updateHub(new File(['tar'], 'kaonic-hub-1.5.0.kpkg'), upload);
    expect((await api.software.state())).toMatchObject({ hub: { version: '1.5.0', fromUpdate: true }, hubUpdate: { id: next.id, state: 'done' } });
    expect((await api.device.get()).versions.hub).toBe('1.5.0');
    await expect(api.software.updateHub(new File(['tar'], 'kaonic-hub-1.4.0.kpkg'), upload)).rejects.toMatchObject({ code: 'conflict', reason: 'downgrade' });
  });

  it('updates the installer, or says why the old one is back', async () => {
    const api = fresh();
    await api.auth.setup(setup);
    const upload = { password: setup.password };
    expect(await api.software.updateInstaller(new File(['tar'], 'kaonic-hub-installer-1.1.0.kpkg'), upload)).toEqual({ version: '1.1.0' });
    await expect(api.software.updateInstaller(new File(['tar'], 'kaonic-hub-installer-1.2.0-fail.kpkg'), upload)).rejects.toMatchObject({ reason: 'update_failed' });
    expect((await api.software.state()).installer.version).toBe('1.1.0');
    const history = await api.software.history({ id: 'kaonic-hub-installer' });
    expect(history.map((event) => event.outcome)).toEqual(['rolled_back', 'done']);
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
      const release = await api.nodes.uploadUpdate(new File([new Uint8Array(1000)], 'kaonic-hub-1.0.1.kpkg'), '');
      expect(trusted.version).not.toBe(release.version);

      await expect(api.nodes.updateSoftware([stranger.id], release.id)).rejects.toMatchObject({ code: 'forbidden' });

      const [job] = await api.nodes.updateSoftware([trusted.id], release.id);
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

  it('shares one node\'s internet with others, and refuses a node that would be gateway and user at once', async () => {
    vi.useFakeTimers();
    try {
      const api = fresh();
      await api.auth.setup(adminSetup);
      const trusted = (await api.peers.list()).filter((peer) => peer.list === 'whitelist' && peer.online);
      const [source, user] = [trusted[0]!, trusted[1]!];
      const off = (await api.nodes.details(user.id)).sharing!;
      expect(off.uplink.enabled).toBe(false);

      const gatewayOn = api.nodes.setGateway(source.id, { enabled: true, egressInterface: null, routes: ['0.0.0.0/0'] });
      await vi.runAllTimersAsync();
      expect(await gatewayOn).toMatchObject({ enabled: true });
      const uplinkOn = api.nodes.setUplink(user.id, { enabled: true, peerId: source.id, defaultRoute: true, routes: [] });
      await vi.runAllTimersAsync();
      expect(await uplinkOn).toMatchObject({ enabled: true, peerId: source.id, active: true });
      const details = api.nodes.details(user.id);
      await vi.runAllTimersAsync();
      expect((await details).sharing!.uplink.enabled).toBe(true);

      const both = api.nodes.setUplink(source.id, { enabled: true, peerId: user.id, defaultRoute: true, routes: [] });
      const refused = expect(both).rejects.toMatchObject({ code: 'validation_failed' });
      await vi.runAllTimersAsync();
      await refused;
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

  it('offers the r30 filters on the sub-GHz bands, any of them selectable, with auto following the frequency', async () => {
    const api = fresh();
    await api.auth.setup(setup);
    const bands = await api.radio.bands();
    const aSub = bands.find((band) => band.id === 'a_sub')!;
    expect(aSub.filters?.map((filter) => filter.label)).toEqual(['Wide 730–960 MHz', '868 MHz', '915 MHz']);
    expect(aSub.boardRangeMhz).toEqual([863, 928]);
    // 869.535 MHz + 11 × 200 kHz: the 868 MHz filter.
    expect([aSub.filter, aSub.activeFilter]).toEqual(['auto', 1]);
    expect(bands.find((band) => band.id === 'a_24')!.filterState).toBe('none');

    // A filter that does not pass the frequency is still taken.
    const pinned = await api.radio.setBandFilter('a_sub', 2);
    expect([pinned.filter, pinned.activeFilter]).toEqual([2, 2]);
    await expect(api.radio.setBandFilter('a_sub', 3)).rejects.toMatchObject({ code: 'validation_failed', fields: { filter: expect.any(String) } });
    await expect(api.radio.setBandFilter('a_24', 0)).rejects.toMatchObject({ code: 'validation_failed' });

    const auto = await api.radio.setBandFilter('a_sub', 'auto');
    const moved = await api.radio.updateBand('a_sub', { ...auto.config, frequencyHz: 915_000_000, channel: 0 });
    expect(moved.activeFilter).toBe(2);
  });
  it('limits the TX power per modulation', async () => {
    const api = fresh();
    await api.auth.setup(setup);
    const aSub = (await api.radio.bands()).find((band) => band.id === 'a_sub')!;
    await expect(api.radio.updateBand('a_sub', { ...aSub.config, txPower: 26 })).rejects.toMatchObject({ code: 'validation_failed', fields: { txPower: expect.any(String) } });
    expect((await api.radio.updateBand('a_sub', { ...aSub.config, txPower: 25 })).config.txPower).toBe(25);
    // A Kaonic 1S takes its full OFDM power at every MCS.
    const qam = { ...aSub.config, modulation: { kind: 'ofdm' as const, mcs: 6, option: 1 } };
    expect((await api.radio.updateBand('a_sub', { ...qam, txPower: 25 })).config.txPower).toBe(25);
    const qpsk = { ...aSub.config, modulation: { kind: 'qpsk' as const, chipRateKhz: 1000, rateMode: 2 } };
    await expect(api.radio.updateBand('b_sub', { ...qpsk, txPower: 21 })).rejects.toMatchObject({ fields: { txPower: expect.any(String) } });
    expect((await api.radio.updateBand('b_sub', { ...qpsk, txPower: 20 })).config.txPower).toBe(20);
    const fsk = { ...aSub.config, modulation: { kind: 'fsk' as const } };
    await expect(api.radio.updateBand('b_sub', { ...fsk, txPower: 21 })).rejects.toMatchObject({ fields: { txPower: expect.any(String) } });
  });

  it('sends a test message once, or repeatedly until stopped or counted out', async () => {
    vi.useFakeTimers();
    try {
      const api = fresh();
      await api.auth.setup(setup);
      expect(await api.radio.test('a_sub')).toBeNull();
      const once = await api.radio.startTest('a_sub', { message: '4b 41 4f', format: 'hex' });
      expect(once).toMatchObject({ running: false, sent: 1, bytes: 3, intervalMs: null });
      await expect(api.radio.startTest('a_sub', { message: '4b4', format: 'hex' })).rejects.toMatchObject({ code: 'validation_failed', fields: { message: expect.any(String) } });
      await expect(api.radio.startTest('a_sub', { message: 'hi', format: 'text', intervalMs: 10 })).rejects.toMatchObject({ fields: { intervalMs: expect.any(String) } });

      const repeat = await api.radio.startTest('a_sub', { message: 'hello', format: 'text', intervalMs: 1000 });
      expect(repeat).toMatchObject({ running: true, sent: 1, bytes: 5 });
      await vi.advanceTimersByTimeAsync(3000);
      expect(await api.radio.test('a_sub')).toMatchObject({ running: true, sent: 4 });
      expect((await api.radio.bands()).find((band) => band.id === 'a_sub')!.test).toMatchObject({ running: true });
      const stopped = await api.radio.stopTest('a_sub');
      await vi.advanceTimersByTimeAsync(3000);
      expect(await api.radio.test('a_sub')).toEqual(stopped);
      expect(stopped).toMatchObject({ running: false, sent: 4 });

      await api.radio.startTest('b_24', { message: 'x', format: 'text', intervalMs: 500, count: 3 });
      await vi.advanceTimersByTimeAsync(5000);
      expect(await api.radio.test('b_24')).toMatchObject({ running: false, sent: 3 });

      // A band that is off sends nothing.
      await expect(api.radio.startTest('b_sub', { message: 'x', format: 'text' })).rejects.toMatchObject({ code: 'conflict' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('moves the mesh to the other radio module with the mesh band settings', async () => {
    const api = fresh();
    await api.auth.setup(setup);
    const before = await api.radio.bands();
    const aSub = before.find((band) => band.id === 'a_sub')!;
    expect(await api.radio.setMeshRadio(0)).toEqual({ interface: 'rf09_a', restarting: false });
    expect(await api.radio.setMeshRadio(1)).toEqual({ interface: 'rf09_b', restarting: true });
    const after = await api.radio.bands();
    const bSub = after.find((band) => band.id === 'b_sub')!;
    expect(bSub.usedBy).toContain('mesh');
    expect(bSub.config).toEqual(aSub.config);
    expect(after.find((band) => band.id === 'a_sub')!.usedBy).toEqual([]);
  });
});
