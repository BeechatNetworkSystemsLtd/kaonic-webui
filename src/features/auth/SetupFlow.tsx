import { useEffect, useState, type FormEvent } from 'react';
import { Dices } from 'lucide-react';
import { isApiError, validationFields, type AdminSecret, type PhraseLength, type SetupInput, type SetupMode } from '@/api';
import { useBootIdentity, useDeriveIdentity, useNewSeedPhrase, useSetup, useWordlist } from '@/data/queries';
import { Button, Field, FormError, Input, LoadError, Notice, Segmented, Skeleton, Switch } from '@/ui';
import { PhraseCard, PhraseInput, pickPositions } from './SeedPhrase';
import { QrCode } from '@/ui/QrCode';
import { AuthLayout } from './AuthLayout';
import styles from './Auth.module.css';

/*
 * First-boot provisioning. The first page shows the identity this device was
 * born with, as a QR code, and offers both ways forward:
 *
 * - connect: the device becomes a member of a mesh, keeps that identity, and
 *   joins once an admin device whitelists it;
 * - create a Kaonic admin: the device makes a seed phrase of 12 or 24 words and
 *   the admin keys are derived from it, so the words are what recovers them; the
 *   user saves the words and types three back to be sure of the copy. Recovering
 *   types the words in, and the identity they give is checked before it is applied.
 *
 * Both then choose whether a password protects the UI (off by default) and the
 * codename, and one call to the hub applies everything and signs the user in.
 *
 * To add a step: add it to STEPS, place it in `stepsFor`, render it in the
 * component below, and name the fields it owns so a server-side validation
 * error returns the user to it.
 */

const MIN_PASSWORD = 8;
const VERIFY_WORDS = 3;
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
  phraseLength: PhraseLength;
  /** The words the device made for a new admin. */
  phrase: string[];
  /** The user says the words are kept. */
  phraseKept: boolean;
  /** Positions asked back, and what was typed for them. */
  verifyAt: number[];
  verify: string[];
  /** The words typed to recover an admin. */
  typed: string[];
  usePassword: boolean;
  password: string;
  repeat: string;
  codename: string;
}

/** The draft's fields, and the hub's name for the phrase. */
type ErrorField = keyof Draft | 'seedPhrase';
type Errors = Partial<Record<ErrorField, string>>;

type StepId = 'start' | 'phrase' | 'verify' | 'recover' | 'confirm' | 'password' | 'codename';

interface Step {
  title: string;
  description: string;
  fields: ReadonlyArray<ErrorField>;
  validate: (draft: Draft) => Errors;
}

const filled = (words: readonly string[]) => words.every((word) => word.length > 0);

const STEPS: Record<StepId, Step> = {
  start: {
    title: 'Connect this device',
    description: 'Scan this code on your Kaonic admin device. This device joins the mesh on its own once the admin adds it.',
    fields: ['mode'],
    validate: () => ({}),
  },
  phrase: {
    title: 'Create Kaonic Admin',
    description:
      'These words are your admin keys. Use them to recover the admin on any Kaonic. Save them and keep them private.',
    fields: ['keySource', 'phraseKept', 'seedPhrase'],
    validate: (draft) => ({
      phraseKept: draft.phraseKept ? undefined : 'Keep the words before you continue.',
    }),
  },
  verify: {
    title: 'Check your seed phrase',
    description: 'Type these words from your copy of the seed phrase, to be sure it is right. Without the words the admin keys cannot be recovered.',
    fields: ['verify'],
    validate: (draft) => ({
      verify: draft.verifyAt.every((at, index) => draft.verify[index] === draft.phrase[at]) ? undefined : 'These words do not match. Check your copy of the phrase.',
    }),
  },
  recover: {
    title: 'Recover Kaonic Admin',
    description: 'Type the seed phrase your admin keys were made from, word by word in order, to make the same keys on this device. Pasting the whole phrase fills every box.',
    fields: ['keySource', 'typed', 'seedPhrase'],
    validate: (draft) => ({ seedPhrase: filled(draft.typed) ? undefined : `Enter all ${draft.typed.length} words.` }),
  },
  confirm: {
    title: 'Is this your admin identity?',
    description: 'Your seed phrase makes the keys of the identity below. Check that it is the one your mesh knows as its admin.',
    fields: [],
    validate: () => ({}),
  },
  password: {
    title: 'Password',
    description: 'Anyone who can open this page can change the settings of this device. You can add a password now or later, in the settings.',
    fields: ['usePassword', 'password', 'repeat'],
    validate: (draft) =>
      draft.usePassword
        ? {
            password: draft.password.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters.` : undefined,
            repeat: draft.repeat !== draft.password ? 'The passwords do not match.' : undefined,
          }
        : {},
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
  const own: StepId[] = draft.mode === 'admin' ? (draft.keySource === 'recover' ? ['recover', 'confirm'] : ['phrase', 'verify']) : [];
  return ['start', ...own, 'password', 'codename'];
}

const KEY_SOURCES: ReadonlyArray<{ value: KeySource; label: string }> = [
  { value: 'create', label: 'Create a new key' },
  { value: 'recover', label: 'Recover a key' },
];

const PHRASE_LENGTHS: ReadonlyArray<{ value: PhraseLength; label: string }> = [
  { value: 12, label: '12 words' },
  { value: 24, label: '24 words' },
];

function adminSecret(draft: Draft): AdminSecret {
  return { seedPhrase: (draft.keySource === 'create' ? draft.phrase : draft.typed).join(' ') };
}

function toInput(draft: Draft): SetupInput {
  const common = { password: draft.usePassword ? draft.password : null, codename: draft.codename };
  return draft.mode === 'admin' ? { ...common, mode: 'admin', ...adminSecret(draft) } : { ...common, mode: 'member' };
}

const hasErrors = (errors: Errors) => Object.values(errors).some(Boolean);
const blank = (length: number) => Array.from({ length }, () => '');

export function SetupFlow() {
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => ({
    mode: 'member',
    keySource: 'create',
    phraseLength: 12,
    phrase: [],
    phraseKept: false,
    verifyAt: [],
    verify: [],
    typed: blank(12),
    usePassword: false,
    password: '',
    repeat: '',
    codename: randomCodename(),
  }));
  const [errors, setErrors] = useState<Errors>({});
  const setup = useSetup();
  const derive = useDeriveIdentity();
  const boot = useBootIdentity();
  const newPhrase = useNewSeedPhrase();
  const wordlist = useWordlist();

  const steps = stepsFor(draft);
  const stepId = steps[stepIndex]!;
  const step = STEPS[stepId];
  const isLast = stepIndex === steps.length - 1;
  const busy = setup.isPending || derive.isPending;

  // A new admin's words come from the device, once per length chosen.
  const { mutate: makePhrase, isPending: making, isError: makeFailed } = newPhrase;
  useEffect(() => {
    if (stepId === 'phrase' && draft.phrase.length === 0 && !making && !makeFailed) {
      makePhrase(draft.phraseLength, { onSuccess: (words) => setDraft((current) => ({ ...current, phrase: words, phraseKept: false })) });
    }
  }, [stepId, draft.phrase.length, draft.phraseLength, making, makeFailed, makePhrase]);

  function update<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, seedPhrase: undefined }));
    // A derived identity belongs to the words it came from.
    if (field === 'typed' || field === 'keySource') derive.reset();
  }

  function setLength(length: PhraseLength) {
    newPhrase.reset();
    setDraft((current) => ({ ...current, phraseLength: length, phrase: [], phraseKept: false, typed: blank(length) }));
    setErrors({});
    derive.reset();
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

    if (stepId === 'phrase') {
      const verifyAt = pickPositions(draft.phrase.length, VERIFY_WORDS);
      setDraft((current) => ({ ...current, verifyAt, verify: blank(verifyAt.length) }));
      return next();
    }
    if (stepId === 'recover') {
      derive.mutate(adminSecret(draft), { onSuccess: next, onError: (error) => setErrors(validationFields(error)) });
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

  /** The verify boxes are indexed by phrase position; the draft keeps them in asked order. */
  const verifyWords = draft.phrase.map((_, at) => draft.verify[draft.verifyAt.indexOf(at)] ?? '');
  function setVerify(words: string[]) {
    update(
      'verify',
      draft.verifyAt.map((at) => words[at] ?? ''),
    );
  }

  const adminTabs =
    stepId === 'phrase' || stepId === 'recover' ? (
      <Segmented
        label="Admin key"
        options={KEY_SOURCES}
        value={draft.keySource}
        onChange={(value) => {
          update('keySource', value);
        }}
      />
    ) : null;

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

        {stepId === 'phrase' ? (
          <>
            {adminTabs}
            <Segmented label="Words" options={PHRASE_LENGTHS} value={draft.phraseLength} onChange={setLength} />
            {newPhrase.isError ? (
              <LoadError error={newPhrase.error} onRetry={() => newPhrase.reset()} />
            ) : draft.phrase.length === 0 ? (
              <Skeleton lines={4} />
            ) : (
              <PhraseCard words={draft.phrase} codename={draft.codename} />
            )}
            <Notice tone="warn">Anyone with these words controls your admin. The device does not keep them: lose them and the admin cannot be recovered.</Notice>
            <label className={styles.check}>
              <input type="checkbox" checked={draft.phraseKept} disabled={draft.phrase.length === 0} onChange={(event) => update('phraseKept', event.target.checked)} />
              <span>I have written down or saved these words.</span>
            </label>
            {errors.phraseKept || errors.seedPhrase ? <p className={styles.error}>{errors.phraseKept ?? errors.seedPhrase}</p> : null}
          </>
        ) : null}

        {stepId === 'verify' ? (
          <>
            <PhraseInput words={verifyWords} onChange={setVerify} positions={draft.verifyAt} wordlist={wordlist.data} autoFocus />
            {errors.verify ? <p className={styles.error}>{errors.verify}</p> : null}
          </>
        ) : null}

        {stepId === 'recover' ? (
          <>
            {adminTabs}
            <Segmented label="Words" options={PHRASE_LENGTHS} value={draft.phraseLength} onChange={setLength} />
            <PhraseInput words={draft.typed} onChange={(words) => update('typed', words)} wordlist={wordlist.data} autoFocus />
            {errors.seedPhrase ? <p className={styles.error}>{errors.seedPhrase}</p> : null}
            {derive.isError && !isApiError(derive.error, 'validation_failed') ? <FormError error={derive.error} /> : null}
          </>
        ) : null}

        {stepId === 'confirm' && derive.data ? (
          <>
            <p className={`${styles.identity} mono`}>{derive.data}</p>
            <p className="muted">If it is not, go back and check the words.</p>
          </>
        ) : null}

        {stepId === 'password' ? (
          <>
            <div className={styles.switchRow}>
              <span>Protect this page with a password</span>
              <Switch label="Protect this page with a password" checked={draft.usePassword} onChange={(value) => update('usePassword', value)} />
            </div>
            {draft.usePassword ? (
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
            ) : (
              <p className="muted">No password: anyone who can reach this device can open its settings.</p>
            )}
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
          <Button type="submit" variant="primary" busy={busy} disabled={(stepId === 'start' && !boot.data) || (stepId === 'phrase' && (draft.phrase.length === 0 || !draft.phraseKept))}>
            {stepId === 'start' ? 'Connect this device' : isLast ? 'Finish setup' : stepId === 'confirm' ? 'Yes, use this key' : 'Continue'}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
