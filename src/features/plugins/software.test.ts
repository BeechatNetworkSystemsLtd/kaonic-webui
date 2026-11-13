import { describe, expect, it } from 'vitest';
import { ApiError, type SoftwareEvent } from '@/api';
import { actionText, compareVersions, isDowngradeRefusal, isInstallerDown, outcomeOf, subjectName, versionsText } from './software';

const event = (fields: Partial<SoftwareEvent>): SoftwareEvent => ({
  time: 0,
  id: 'mesh-chat',
  action: 'upgrade',
  outcome: 'done',
  from: null,
  to: null,
  signed: true,
  actor: null,
  message: '',
  ...fields,
});

describe('software words', () => {
  it('knows the refusals the UI answers with a choice', () => {
    expect(isDowngradeRefusal(new ApiError('conflict', 'tracker 1.0.0 is older than 2.0.0 installed before', {}, 'downgrade'))).toBe(true);
    // Only the code counts, not the wording.
    expect(isDowngradeRefusal(new ApiError('conflict', 'tracker 1.0.0 is older than 2.0.0 installed before'))).toBe(false);
    expect(isInstallerDown(new ApiError('unavailable', 'Not running.', {}, 'installer_unavailable'))).toBe(true);
    expect(isInstallerDown(new ApiError('unavailable', 'Radio down.', {}, 'radio_unavailable'))).toBe(false);
  });

  it('compares versions by number', () => {
    expect(compareVersions('1.4.10', '1.5.0')).toBeLessThan(0);
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
  });

  it('says what happened to what', () => {
    const names = new Map([['mesh-chat', 'Mesh chat']]);
    expect(subjectName('mesh-chat', names)).toBe('Mesh chat');
    expect(subjectName('kaonic-hub', names)).toBe('Hub');
    expect(subjectName('gone', names)).toBe('gone');
    expect(actionText(event({ action: 'rollback' }))).toBe('Rolled back');
    expect(versionsText(event({ from: '1.0.4', to: '1.1.0' }))).toBe('1.0.4 → 1.1.0');
    expect(versionsText(event({ to: '0.9.0' }))).toBe('→ 0.9.0');
    expect(versionsText(event({}))).toBe('');
    expect(outcomeOf(event({ outcome: 'rolled_back', from: '1.0.4' }))).toEqual({ text: 'Rolled back to 1.0.4', tone: 'warn' });
    expect(outcomeOf(event({ outcome: 'failed' })).tone).toBe('danger');
  });
});
