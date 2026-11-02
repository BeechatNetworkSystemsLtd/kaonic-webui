import { useState, type FormEvent } from 'react';
import { Dices } from 'lucide-react';
import { isApiError, validationFields, type SetupInput, type SetupMode } from '@/api';
import { useBootIdentity, useDeriveIdentity, useSetup } from '@/data/queries';
import { Button, Field, FormError, Input, LoadError, Segmented, Skeleton } from '@/ui';
import { QrCode } from '@/ui/QrCode';
import { AuthLayout } from './AuthLayout';
import styles from './Auth.module.css';

/*
 * First-boot provisioning. The first page shows the identity this device was
 * born with, as a QR code, and offers both ways forward:
 *
 * - connect: the device becomes a member of a mesh, keeps that identity, and
 *   joins once an admin device whitelists it;
 * - create a Kaonic admin: the device's key is derived from a seed password
 *   (a new key, or a recovered one, checked by its identity before it is applied).
 *
 * Both then set the UI password and the codename, and one call to the hub
 * applies everything and signs the user in.
 *
 * To add a step: add it to STEPS, place it in `stepsFor`, render it in the
 * component below, and name the fields it owns so a server-side validation
 * error returns the user to it.
 */

const MIN_PASSWORD = 8;
const MIN_SEED_PASSWORD = 12;
const CODENAME_PATTERN = /^[a-z0-9]{8}$/;
const CODENAME_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A fresh suggestion: 8 random lowercase letters or digits. */
function randomCodename(): string {
  let codename = '';
  while (codename.length < 8) {
    for (const byte of crypto.getRandomValues(new Uint8Array(8))) {
      // 252 is the largest multiple of 36 below 256: anything above would favour the first characters.
      if (byte < 252 && codename.length < 8) codename += CODENAME_ALPHABET[byte % CODENAME_ALPHABET.length];
    }
  }
  return codename;
}

type KeySource = 'create' | 'recover';

interface Draft {
  mode: SetupMode;
  keySource: KeySource;
  seedPassword: string;
  seedRepeat: string;
  password: string;
  repeat: string;
  codename: string;
}

type Errors = Partial<Record<keyof Draft, string>>;

type StepId = 'start' | 'key' | 'confirm' | 'password' | 'codename';

interface Step {
  title: string;
  description: string;
  fields: ReadonlyArray<keyof Draft>;
  validate: (draft: Draft) => Errors;
}

const STEPS: Record<StepId, Step> = {
  start: {
    title: 'Connect this device',
    description: 'Scan this code on your Kaonic admin device. This device joins the mesh on its own once the admin adds it.',
    fields: ['mode'],
    validate: () => ({}),
  },
  key: {
    title: 'Create Kaonic Admin',
    description: 'The admin key is made from a seed password. The same seed password always makes the same key, which is how the key is recovered.',
    fields: ['keySource', 'seedPassword', 'seedRepeat'],
    validate: (draft) => ({
      seedPassword: draft.seedPassword.length < MIN_SEED_PASSWORD ? `Use at least ${MIN_SEED_PASSWORD} characters.` : undefined,
      seedRepeat: draft.keySource === 'create' && draft.seedRepeat !== draft.seedPassword ? 'The seed passwords do not match.' : undefined,
    }),
  },
  confirm: {
    title: 'Is this your admin identity?',
    description: 'Your seed password makes the identity below. Check that it is the one your mesh knows as its admin.',
    fields: [],
    validate: () => ({}),
  },
  password: {
    title: 'Set a password',
    description: 'Choose the password that protects the settings of this device.',
    fields: ['password', 'repeat'],
    validate: (draft) => ({
      password:
        draft.password.length < MIN_PASSWORD
          ? `Use at least ${MIN_PASSWORD} characters.`
          : draft.mode === 'admin' && draft.password === draft.seedPassword
            ? 'Use a different password from the seed password.'
            : undefined,
      repeat: draft.repeat !== draft.password ? 'The passwords do not match.' : undefined,
    }),
  },
  codename: {
    title: 'Name this device',
    description: 'Other devices on the mesh see this name. Keep the one made up for you, or choose your own.',
    fields: ['codename'],
    validate: (draft) => ({
      codename: CODENAME_PATTERN.test(draft.codename) ? undefined : 'Use exactly 8 lowercase letters or digits.',
    }),
  },
};

/** The steps of the path the draft is on. Only a recovered key is shown for checking. */
function stepsFor(draft: Draft): StepId[] {
  const own: StepId[] = draft.mode === 'admin' ? (draft.keySource === 'recover' ? ['key', 'confirm'] : ['key']) : [];
  return ['start', ...own, 'password', 'codename'];
}

const KEY_SOURCES: ReadonlyArray<{ value: KeySource; label: string }> = [
  { value: 'create', label: 'Create a new key' },
  { value: 'recover', label: 'Recover a key' },
];

function toInput(draft: Draft): SetupInput {
  const common = { password: draft.password, codename: draft.codename };
  return draft.mode === 'admin' ? { ...common, mode: 'admin', seedPassword: draft.seedPassword } : { ...common, mode: 'member' };
}

const hasErrors = (errors: Errors) => Object.values(errors).some(Boolean);

export function SetupFlow() {
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => ({
    mode: 'member',
    keySource: 'create',
    seedPassword: '',
    seedRepeat: '',
    password: '',
    repeat: '',
    codename: randomCodename(),
  }));
  const [errors, setErrors] = useState<Errors>({});
  const setup = useSetup();
  const derive = useDeriveIdentity();
  const boot = useBootIdentity();

  const steps = stepsFor(draft);
  const stepId = steps[stepIndex]!;
  const step = STEPS[stepId];
  const isLast = stepIndex === steps.length - 1;
  const busy = setup.isPending || derive.isPending;

  function update<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    // A derived identity belongs to the seed password it came from.
    if (field === 'seedPassword' || field === 'keySource') derive.reset();
  }

  /** Leaves the first page down one of its two paths. */
  function choose(mode: SetupMode) {
    update('mode', mode);
    setStepIndex(1);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (stepId === 'start') return choose('member');
    const found = step.validate(draft);
    setErrors(found);
    if (hasErrors(found)) return;
    const next = () => setStepIndex(stepIndex + 1);

    if (stepId === 'key' && draft.keySource === 'recover') {
      derive.mutate(draft.seedPassword, { onSuccess: next, onError: (error) => setErrors(validationFields(error)) });
      return;
    }
    if (!isLast) return next();

    setup.mutate(toInput(draft), {
      onError: (error) => {
        if (!isApiError(error, 'validation_failed')) return;
        // The hub disagreed with a field: show its message on the step that owns the field.
        setErrors(error.fields);
        const owner = steps.findIndex((id) => STEPS[id].fields.some((field) => field in error.fields));
        if (owner >= 0) setStepIndex(owner);
      },
    });
  }

  return (
    <AuthLayout
      title={step.title}
      description={step.description}
      above={
        stepId === 'start' ? null : (
          <div className={styles.steps}>
            <span>
              Step {stepIndex} of {steps.length - 1}
            </span>
            <span className={styles.stepBars} aria-hidden>
              {steps.slice(1).map((id, index) => (
                <span key={id} className={styles.stepBar} data-done={index < stepIndex} />
              ))}
            </span>
          </div>
        )
      }
    >
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {stepId === 'start' ? (
          boot.isPending ? (
            <Skeleton lines={4} />
          ) : boot.isError ? (
            <LoadError error={boot.error} onRetry={() => void boot.refetch()} />
          ) : (
            <div className={styles.join}>
              <QrCode value={boot.data} label="This device's identity, as a QR code" />
              <p className={`${styles.identity} mono`}>{boot.data}</p>
            </div>
          )
        ) : null}

        {stepId === 'key' ? (
          <>
            <Segmented label="Admin key" options={KEY_SOURCES} value={draft.keySource} onChange={(value) => update('keySource', value)} />
            <Field
              label="Seed password"
              hint={
                draft.keySource === 'create'
                  ? `At least ${MIN_SEED_PASSWORD} characters. Anyone who has it can make your admin key: write it down and keep it apart from the device.`
                  : 'The seed password your admin key was made with.'
              }
              error={errors.seedPassword}
            >
              {(control) => (
                <Input {...control} type="password" autoComplete="off" autoFocus value={draft.seedPassword} onChange={(event) => update('seedPassword', event.target.value)} />
              )}
            </Field>
            {draft.keySource === 'create' ? (
              <Field label="Repeat seed password" error={errors.seedRepeat}>
                {(control) => (
                  <Input {...control} type="password" autoComplete="off" value={draft.seedRepeat} onChange={(event) => update('seedRepeat', event.target.value)} />
                )}
              </Field>
            ) : null}
            <FormError error={derive.error} />
          </>
        ) : null}

        {stepId === 'confirm' && derive.data ? (
          <>
            <p className={`${styles.identity} mono`}>{derive.data}</p>
            <p className="muted">If it is not, go back and check the seed password.</p>
          </>
        ) : null}

        {stepId === 'password' ? (
          <>
            <Field label="Password" hint={`At least ${MIN_PASSWORD} characters.`} error={errors.password}>
              {(control) => (
                <Input {...control} type="password" autoComplete="new-password" autoFocus value={draft.password} onChange={(event) => update('password', event.target.value)} />
              )}
            </Field>
            <Field label="Repeat password" error={errors.repeat}>
              {(control) => (
                <Input {...control} type="password" autoComplete="new-password" value={draft.repeat} onChange={(event) => update('repeat', event.target.value)} />
              )}
            </Field>
          </>
        ) : null}

        {stepId === 'codename' ? (
          <Field label="Codename" hint="Exactly 8 lowercase letters or digits." error={errors.codename}>
            {(control) => (
              <div className={styles.codename}>
                <Input
                  {...control}
                  className="mono"
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={8}
                  value={draft.codename}
                  onChange={(event) => update('codename', event.target.value.toLowerCase())}
                />
                <Button iconOnly aria-label="Make up another codename" title="Make up another codename" onClick={() => update('codename', randomCodename())}>
                  <Dices />
                </Button>
              </div>
            )}
          </Field>
        ) : null}

        <FormError error={setup.error} />

        <div className={styles.actions}>
          {stepId === 'start' ? (
            <Button onClick={() => choose('admin')}>Create Kaonic Admin</Button>
          ) : (
            <Button onClick={() => setStepIndex(stepIndex - 1)} disabled={busy}>
              Back
            </Button>
          )}
          <Button type="submit" variant="primary" busy={busy} disabled={stepId === 'start' && !boot.data}>
            {stepId === 'start' ? 'Connect this device' : isLast ? 'Finish setup' : stepId === 'confirm' ? 'Yes, use this key' : 'Continue'}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
