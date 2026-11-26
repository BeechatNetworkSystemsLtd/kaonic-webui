import { describe, expect, it } from 'vitest';
import { createMockApi, memoryStore } from './mockApi';

const fresh = () => createMockApi({ latencyMs: 0, storage: memoryStore() });
const member = { mode: 'member', password: 'correct-horse', codename: 'kaon7qjt' } as const;
const admin = { ...member, mode: 'admin', seedPhrase: 'legal winner thank year wave sausage worth useful legal winner thank yellow' } as const;

describe('mock forgotten password reset', () => {
  it('erases a member with its serial and ERASE, and refuses wrong input', async () => {
    const api = fresh();
    await api.auth.setup(member);
    await api.auth.logout();
    expect(await api.auth.forgotMethods()).toEqual({ usb: true, seed: false, setUp: true });
    await expect(api.auth.forgotReset({ method: 'usb', serial: 'K1S-00-000000', confirm: 'ERASE' })).rejects.toMatchObject({ fields: { serial: expect.any(String) } });
    await expect(api.auth.forgotReset({ method: 'usb', serial: 'K1S-30-004217', confirm: 'erase' })).rejects.toMatchObject({ fields: { confirm: expect.any(String) } });
    await expect(api.auth.forgotReset({ method: 'seed', seedPhrase: admin.seedPhrase, confirm: 'ERASE' })).rejects.toMatchObject({ code: 'forbidden' });
    await api.auth.forgotReset({ method: 'usb', serial: ' K1S-30-004217 ', confirm: 'ERASE' });
    expect((await api.auth.state()).setupRequired).toBe(true);
  });

  it('erases the admin device with its seed phrase only', async () => {
    const api = fresh();
    await api.auth.setup(admin);
    await api.auth.logout();
    expect((await api.auth.forgotMethods()).seed).toBe(true);
    const other = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
    await expect(api.auth.forgotReset({ method: 'seed', seedPhrase: other, confirm: 'ERASE' })).rejects.toMatchObject({ fields: { seedPhrase: expect.any(String) } });
    await api.auth.forgotReset({ method: 'seed', seedPhrase: admin.seedPhrase, confirm: 'ERASE' });
    expect((await api.auth.state()).setupRequired).toBe(true);
  });
});
