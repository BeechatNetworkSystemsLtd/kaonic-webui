import { useState } from 'react';
import type { CcaConfig, FrontendConfig, Modulation, RadioCapability, RadioConfig } from '@/api';
import { maxTxPower } from '@/api/radioLimits';
import { formatFrequency } from '@/lib/format';
import { Button, Field, Input, Select, Switch } from '@/ui';
import styles from './RadioConfigFields.module.css';

/*
 * The form fields for one radio band, and the state behind them. Used for this
 * device's own bands (Radio page) and for the bands of other nodes (Nodes).
 */

const MODULATION_LABELS: Record<Modulation['kind'], string> = { off: 'Off', ofdm: 'OFDM', qpsk: 'QPSK', fsk: 'FSK' };

/** What a modulation starts with when the user switches to it. */
const MODULATION_DEFAULTS: { [K in Modulation['kind']]: Extract<Modulation, { kind: K }> } = {
  off: { kind: 'off' },
  fsk: { kind: 'fsk', symbolRateKhz: 200, modulationIndex: 1, order: 2, bt: 0.5, fec: false, whitening: true, preamble: 8 },
  ofdm: { kind: 'ofdm', mcs: 6, option: 1 },
  qpsk: { kind: 'qpsk', chipRateKhz: 100, rateMode: 0 },
};

const OFDM_MCS = ['BPSK 1/2, 4x repeat', 'BPSK 1/2, 2x repeat', 'QPSK 1/2, 2x repeat', 'QPSK 1/2', 'QPSK 3/4', '16-QAM 1/2', '16-QAM 3/4'];

const FSK_SYMBOL_RATES = [50, 100, 150, 200, 300, 400];
const FSK_MODULATION_INDEX = [0.375, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const FSK_BT = [0.5, 1, 1.5, 2];
const CCA_DEFAULT: CcaConfig = { enabled: true, thresholdDbm: -80, listenUs: 0, retries: 96, backoffUs: 500 };
const FRONTEND_DEFAULT: FrontendConfig = { agcMap: 2, agcTarget: 3, lnaBypass: false };

/** The tunable limits of a band. */
export interface FrequencyLimits {
  minHz: number;
  maxHz: number;
  /** The ranges the channel centre must fall in (sub-GHz has two); defaults to min..max. */
  rangesHz?: [number, number][];
}

/** The RF215 tunes to frequency + channel × spacing. */
export function centreHz(config: Pick<RadioConfig, 'frequencyHz' | 'channel' | 'channelSpacingHz'>): number {
  return config.frequencyHz + config.channel * config.channelSpacingHz;
}

/** Whether the channel centre falls in one of the band's ranges. */
export function centreInBand(centre: number, limits: FrequencyLimits): boolean {
  const ranges = limits.rangesHz ?? [[limits.minHz, limits.maxHz]];
  return ranges.some(([low, high]) => centre >= low && centre <= high);
}

function describeRanges(limits: FrequencyLimits): string {
  const ranges = limits.rangesHz ?? [[limits.minHz, limits.maxHz]];
  return ranges.map(([low, high]) => `${low / 1_000_000}–${high / 1_000_000} MHz`).join(' or ');
}

/** Problems a draft has before it is sent: the hub checks the same and more. */
export function draftProblems(config: RadioConfig, limits: FrequencyLimits): Record<string, string> {
  const problems: Record<string, string> = {};
  if (config.modulation.kind === 'off') return problems;
  const maxPower = maxTxPower(config.modulation.kind);
  if (!Number.isInteger(config.txPower) || config.txPower < 0 || config.txPower > maxPower) problems.txPower = `Use 0 to ${maxPower} with this modulation.`;
  if (!centreInBand(centreHz(config), limits)) {
    problems.frequencyHz = `The channel centre ${formatFrequency(centreHz(config))} is outside ${describeRanges(limits)}.`;
  }
  if (!Number.isInteger(config.channel) || config.channel < 0 || config.channel > 65535) problems.channel = 'Use 0 to 65535.';
  if (!(config.channelSpacingHz >= 1 && config.channelSpacingHz <= 6_375_000)) problems.channelSpacingHz = 'Use 0.001 to 6375 kHz.';
  if (config.modulation.kind === 'fsk' && config.modulation.preamble !== undefined && (config.modulation.preamble < 1 || config.modulation.preamble > 1023)) {
    problems['modulation.preamble'] = 'Use 1 to 1023.';
  }
  if (config.cca) {
    if (config.cca.thresholdDbm < -127 || config.cca.thresholdDbm > 4) problems['cca.thresholdDbm'] = 'Use −127 to 4 dBm.';
    if (config.cca.listenUs < 0 || config.cca.listenUs > 8064) problems['cca.listenUs'] = 'Use 0 to 8064 µs.';
    if (config.cca.retries < 0 || config.cca.retries > 255) problems['cca.retries'] = 'Use 0 to 255.';
    if (config.cca.backoffUs < 0 || config.cca.backoffUs > 2000) problems['cca.backoffUs'] = 'Use 0 to 2000 µs.';
  }
  return problems;
}

export interface RadioDraft {
  /** The settings as they would be sent. */
  config: RadioConfig;
  /** False while the frequency typed in is not a usable one. A band that is off is always valid. */
  valid: boolean;
  /** True when the draft differs from the saved settings. */
  dirty: boolean;
  /** Internal to `RadioConfigFields`. */
  fields: {
    config: RadioConfig;
    frequencyMhz: string;
    frequencyValid: boolean;
    limits: FrequencyLimits;
    patch: (change: Partial<RadioConfig>) => void;
    setFrequencyMhz: (text: string) => void;
  };
}

/** Editing state for one band's settings, starting from the saved ones. */
export function useRadioDraft(saved: RadioConfig, limits: FrequencyLimits): RadioDraft {
  // A node on older software may run above today's limit: the draft starts within it.
  const [config, setConfig] = useState<RadioConfig>(() => ({ ...saved, txPower: Math.min(saved.txPower, maxTxPower(saved.modulation.kind)) }));
  // The frequency is kept as typed, so half-entered numbers are not rewritten under the cursor.
  const [frequencyMhz, setFrequencyMhz] = useState(String(saved.frequencyHz / 1_000_000));

  const frequencyHz = Math.round(Number(frequencyMhz) * 1_000_000);
  const typed = Number.isFinite(frequencyHz) && frequencyHz > 0;
  const off = config.modulation.kind === 'off';
  // Switching a band off must not also save whatever was left in the frequency box.
  const next: RadioConfig = { ...config, frequencyHz: off || !typed ? saved.frequencyHz : frequencyHz };
  const frequencyValid = typed && centreInBand(centreHz(next), limits);

  return {
    config: next,
    valid: off || (frequencyValid && Object.keys(draftProblems(next, limits)).length === 0),
    dirty: JSON.stringify(next) !== JSON.stringify(saved),
    fields: { config, frequencyMhz, frequencyValid, limits, patch: (change) => setConfig((current) => ({ ...current, ...change })), setFrequencyMhz },
  };
}

interface RadioConfigFieldsProps {
  draft: RadioDraft;
  /** Messages from the device, by field name. */
  errors?: Readonly<Record<string, string>>;
  /** Optional settings this band offers (this device's own bands); none for other nodes. */
  capabilities?: readonly RadioCapability[];
}

export function RadioConfigFields({ draft, errors = {}, capabilities = [] }: RadioConfigFieldsProps) {
  const { config, frequencyMhz, frequencyValid, limits, patch, setFrequencyMhz } = draft.fields;
  const { modulation } = config;
  const frequencyRange = describeRanges(limits);
  const [advanced, setAdvanced] = useState(false);
  const can = (capability: RadioCapability) => capabilities.includes(capability);
  const kinds = (Object.keys(MODULATION_LABELS) as Modulation['kind'][]).filter(
    (kind) => kind === 'ofdm' || capabilities.length === 0 || can(kind) || kind === modulation.kind,
  );
  const problems = draftProblems(draft.config, limits);
  const cca = config.cca ?? CCA_DEFAULT;
  const frontend = config.frontend ?? FRONTEND_DEFAULT;

  return (
    <>
      <Field label="Modulation">
        {(control) => (
          <Select
            {...control}
            value={modulation.kind}
            onChange={(event) => {
              const kind = event.target.value as Modulation['kind'];
              // A lower limit brings the power down with it.
              patch({ modulation: MODULATION_DEFAULTS[kind], txPower: Math.min(config.txPower, maxTxPower(kind)) });
            }}
          >
            {kinds.map((kind) => (
              <option key={kind} value={kind}>{MODULATION_LABELS[kind]}</option>
            ))}
          </Select>
        )}
      </Field>

      {modulation.kind === 'ofdm' ? (
        <div className={styles.pair}>
          <Field label="Rate" hint="Lower rates reach further.">
            {(control) => (
              <Select {...control} value={modulation.mcs} onChange={(event) => patch({ modulation: { ...modulation, mcs: Number(event.target.value) } })}>
                {OFDM_MCS.map((label, mcs) => (
                  <option key={mcs} value={mcs}>{label}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Bandwidth option">
            {(control) => (
              <Select {...control} value={modulation.option} onChange={(event) => patch({ modulation: { ...modulation, option: Number(event.target.value) } })}>
                {[1, 2, 3, 4].map((option) => (
                  <option key={option} value={option}>Option {option}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      ) : null}

      {modulation.kind === 'qpsk' ? (
        <div className={styles.pair}>
          <Field label="Chip rate">
            {(control) => (
              <Select {...control} value={modulation.chipRateKhz} onChange={(event) => patch({ modulation: { ...modulation, chipRateKhz: Number(event.target.value) } })}>
                {[100, 200, 1000, 2000].map((rate) => (
                  <option key={rate} value={rate}>{rate} kchip/s</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Rate mode">
            {(control) => (
              <Select {...control} value={modulation.rateMode} onChange={(event) => patch({ modulation: { ...modulation, rateMode: Number(event.target.value) } })}>
                {[0, 1, 2, 3, 4].map((mode) => (
                  <option key={mode} value={mode}>Mode {mode}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      ) : null}

      {modulation.kind === 'fsk' ? (
        <>
          <div className={styles.pair}>
            <Field label="Symbol rate">
              {(control) => (
                <Select {...control} value={modulation.symbolRateKhz ?? 200} onChange={(event) => patch({ modulation: { ...modulation, symbolRateKhz: Number(event.target.value) } })}>
                  {FSK_SYMBOL_RATES.map((rate) => (
                    <option key={rate} value={rate}>{rate} ksym/s</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Order">
              {(control) => (
                <Select {...control} value={modulation.order ?? 2} onChange={(event) => patch({ modulation: { ...modulation, order: Number(event.target.value) === 4 ? 4 : 2 } })}>
                  <option value={2}>2-FSK</option>
                  <option value={4}>4-FSK</option>
                </Select>
              )}
            </Field>
          </div>
          <div className={styles.pair}>
            <Field label="Modulation index">
              {(control) => (
                <Select {...control} value={modulation.modulationIndex ?? 1} onChange={(event) => patch({ modulation: { ...modulation, modulationIndex: Number(event.target.value) } })}>
                  {FSK_MODULATION_INDEX.map((index) => (
                    <option key={index} value={index}>{index}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Gaussian BT">
              {(control) => (
                <Select {...control} value={modulation.bt ?? 0.5} onChange={(event) => patch({ modulation: { ...modulation, bt: Number(event.target.value) } })}>
                  {FSK_BT.map((bt) => (
                    <option key={bt} value={bt}>{bt}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className={styles.pair}>
            <Field label="Preamble, octets" error={errors['modulation.preamble'] ?? problems['modulation.preamble']}>
              {(control) => (
                <Input {...control} className="num" type="number" min={1} max={1023} value={modulation.preamble ?? 8} onChange={(event) => patch({ modulation: { ...modulation, preamble: Number(event.target.value) } })} />
              )}
            </Field>
            <div className={styles.switches}>
              <Toggle label="Forward error correction" checked={modulation.fec ?? false} onChange={(fec) => patch({ modulation: { ...modulation, fec } })} />
              <Toggle label="Data whitening" checked={modulation.whitening ?? true} onChange={(whitening) => patch({ modulation: { ...modulation, whitening } })} />
            </div>
          </div>
        </>
      ) : null}

      {modulation.kind !== 'off' ? (
        <>
          <div className={styles.pair}>
            <Field label="Frequency, MHz" hint={frequencyRange} error={errors.frequencyHz ?? (frequencyValid ? undefined : problems.frequencyHz ?? `Use ${frequencyRange}.`)}>
              {(control) => <Input {...control} className="num" inputMode="decimal" value={frequencyMhz} onChange={(event) => setFrequencyMhz(event.target.value)} />}
            </Field>
            <Field label="Channel" error={errors.channel ?? problems.channel}>
              {(control) => (
                <Input {...control} className="num" type="number" min={0} max={65535} value={config.channel} onChange={(event) => patch({ channel: Number(event.target.value) })} />
              )}
            </Field>
          </div>
          <div className={styles.pair}>
            <Field label="Channel spacing, kHz" error={errors.channelSpacingHz ?? problems.channelSpacingHz}>
              {(control) => (
                <Input
                  {...control}
                  className="num"
                  inputMode="decimal"
                  value={config.channelSpacingHz / 1000}
                  onChange={(event) => patch({ channelSpacingHz: Math.round(Number(event.target.value) * 1000) })}
                />
              )}
            </Field>
            <Field label="Channel centre" hint="Frequency + channel × spacing: what the radio tunes to.">
              {(control) => <Input {...control} className="num" readOnly value={formatFrequency(centreHz(draft.config))} />}
            </Field>
          </div>
          <Field
            label={`Transmit power: ${config.txPower} of ${maxTxPower(modulation.kind)}`}
            hint={`Use the lowest power that keeps the link stable. The limit is ${maxTxPower('ofdm')} with OFDM and ${maxTxPower('qpsk')} with QPSK.`}
            error={errors.txPower ?? problems.txPower}
          >
            {(control) => (
              <input
                {...control}
                className={styles.range}
                type="range"
                min={0}
                max={maxTxPower(modulation.kind)}
                value={Math.min(config.txPower, maxTxPower(modulation.kind))}
                onChange={(event) => patch({ txPower: Number(event.target.value) })}
              />
            )}
          </Field>

          {can('cca') || can('frontend') || can('fcs') ? (
            <Button type="button" variant="ghost" size="small" onClick={() => setAdvanced((open) => !open)} aria-expanded={advanced}>
              {advanced ? 'Hide advanced' : 'Advanced: listen before talk, receiver, FCS'}
            </Button>
          ) : null}

          {advanced && can('cca') ? (
            <fieldset className={styles.group}>
              <legend>Listen before talk</legend>
              <Toggle label="Check the channel is free before sending" checked={cca.enabled} onChange={(enabled) => patch({ cca: { ...cca, enabled } })} />
              <div className={styles.pair}>
                <Field label="Busy above, dBm" error={errors['cca.thresholdDbm'] ?? problems['cca.thresholdDbm']}>
                  {(control) => (
                    <Input {...control} className="num" type="number" min={-127} max={4} value={cca.thresholdDbm} onChange={(event) => patch({ cca: { ...cca, thresholdDbm: Number(event.target.value) } })} />
                  )}
                </Field>
                <Field label="Listen time, µs" hint="0: the modulation's own." error={errors['cca.listenUs'] ?? problems['cca.listenUs']}>
                  {(control) => (
                    <Input {...control} className="num" type="number" min={0} max={8064} value={cca.listenUs} onChange={(event) => patch({ cca: { ...cca, listenUs: Number(event.target.value) } })} />
                  )}
                </Field>
              </div>
              <div className={styles.pair}>
                <Field label="Retries when busy" error={errors['cca.retries'] ?? problems['cca.retries']}>
                  {(control) => (
                    <Input {...control} className="num" type="number" min={0} max={255} value={cca.retries} onChange={(event) => patch({ cca: { ...cca, retries: Number(event.target.value) } })} />
                  )}
                </Field>
                <Field label="Backoff, µs" error={errors['cca.backoffUs'] ?? problems['cca.backoffUs']}>
                  {(control) => (
                    <Input {...control} className="num" type="number" min={0} max={2000} value={cca.backoffUs} onChange={(event) => patch({ cca: { ...cca, backoffUs: Number(event.target.value) } })} />
                  )}
                </Field>
              </div>
            </fieldset>
          ) : null}

          {advanced && can('frontend') ? (
            <fieldset className={styles.group}>
              <legend>Receiver</legend>
              <div className={styles.pair}>
                <Field label="AGC map">
                  {(control) => (
                    <Select {...control} value={frontend.agcMap} onChange={(event) => patch({ frontend: { ...frontend, agcMap: Number(event.target.value) } })}>
                      {[0, 1, 2].map((map) => (
                        <option key={map} value={map}>Map {map}</option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="AGC target">
                  {(control) => (
                    <Select {...control} value={frontend.agcTarget} onChange={(event) => patch({ frontend: { ...frontend, agcTarget: Number(event.target.value) } })}>
                      {[0, 1, 2, 3, 4, 5, 6, 7].map((target) => (
                        <option key={target} value={target}>Target {target}</option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <Toggle label="Bypass the external LNA" checked={frontend.lnaBypass} onChange={(lnaBypass) => patch({ frontend: { ...frontend, lnaBypass } })} />
            </fieldset>
          ) : null}

          {advanced && can('fcs') ? (
            <Toggle label="Chip appends a frame check sequence (the mesh runs without it)" checked={config.fcs ?? false} onChange={(fcs) => patch({ fcs })} />
          ) : null}
        </>
      ) : null}
    </>
  );
}

/** A switch with its label beside it. */
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className={styles.toggle}>
      <span>{label}</span>
      <Switch label={label} checked={checked} onChange={onChange} />
    </div>
  );
}

/** "869.535 MHz, OFDM", or "Off". */
export function describeRadio(config: RadioConfig): string {
  if (config.modulation.kind === 'off') return 'Off';
  return `${formatFrequency(config.frequencyHz)}, ${MODULATION_LABELS[config.modulation.kind]}`;
}
