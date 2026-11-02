import { describe, expect, it } from 'vitest';
import { createMockApi, memoryStore } from './mockApi';

const fresh = () => createMockApi({ latencyMs: 0, storage: memoryStore() });
const member = { mode: 'member', password: 'correct-horse', codename: 'kaon7qjt' } as const;
const admin = { ...member, mode: 'admin', seedPassword: 'long enough seed phrase' } as const;

describe('mock forgotten password reset', () => {
  it('erases a member with its serial and ERASE, and refuses wrong input', async () => {
    const api = fresh();
    await api.auth.setup(member);
    await api.auth.logout();
    expect(await api.auth.forgotMethods()).toEqual({ usb: true, seed: false, setUp: true });
    await expect(api.auth.forgotReset({ method: 'usb', serial: 'K1S-00-000000', confirm: 'ERASE' })).rejects.toMatchObject({ fields: { serial: expect.any(String) } });
    await expect(api.auth.forgotReset({ method: 'usb', serial: 'K1S-30-004217', confirm: 'erase' })).rejects.toMatchObject({ fields: { confirm: expect.any(String) } });
    await expect(api.auth.forgotReset({ method: 'seed', seedPassword: admin.seedPassword, confirm: 'ERASE' })).rejects.toMatchObject({ code: 'forbidden' });
    await api.auth.forgotReset({ method: 'usb', serial: ' K1S-30-004217 ', confirm: 'ERASE' });
    expect((await api.auth.state()).setupRequired).toBe(true);
  });

  it('erases the admin device with its seed password only', async () => {
    const api = fresh();
    await api.auth.setup(admin);
    await api.auth.logout();
    expect((await api.auth.forgotMethods()).seed).toBe(true);
    await expect(api.auth.forgotReset({ method: 'seed', seedPassword: 'another long seed phrase', confirm: 'ERASE' })).rejects.toMatchObject({ fields: { seedPassword: expect.any(String) } });
    await api.auth.forgotReset({ method: 'seed', seedPassword: admin.seedPassword, confirm: 'ERASE' });
    expect((await api.auth.state()).setupRequired).toBe(true);
  });
});
