import { useState, type ReactNode } from 'react';
import { validationFields, type PttAudioDevice, type PttSettings, type PttState } from '@/api';
import { PTT_RANGES, pttSettingsProblems } from '@/api/pttSettings';
import { usePttDevices, usePttTestTone, useUpdatePttSettings } from '@/data/queries';
import { Button, FormError, Notice, Panel, Segmented, Select, Switch } from '@/ui';
import { RangeSetting, Row } from './controls';
import { PttTestPanel } from './PttTestPanel';
import styles from './TalkPage.module.css';

/*
 * The plugin's few settings up front (microphone, speaker, volume, mic gain,
 * silence detection, test tone); everything else under Advanced. Each control
 * saves on its own; what the hub would refuse is said before saving.
 */

type Errors = Partial<Record<keyof PttSettings, string>>;

const kbps = (bps: number) => `${(bps / 1000).toFixed(0)} kbps`;
const ms = (value: number) => `${value} ms`;
const db = (value: number) => `${value} dB`;
const dbfs = (value: number) => `${value} dBFS`;
const pct = (value: number) => `${value} %`;

/** A level 0..1 (RMS against full scale) in dBFS, as the squelch measures it. */
export const levelDbfs = (level: number) => (level > 0 ? Math.max(-90, Math.round(20 * Math.log10(level))) : -90);

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.group} aria-label={title}>
      <h3 className={styles.groupTitle}>{title}</h3>
      <div className={styles.rows}>{children}</div>
    </section>
  );
}

function DeviceSelect({
  label,
  value,
  devices,
  disabled,
  error,
  onChange,
}: {
  label: string;
  value: string;
  devices: PttAudioDevice[] | undefined;
  disabled: boolean;
  error?: string;
  onChange: (name: string) => void;
}) {
  // The saved device stays listed even when it is not plugged in now.
  const options = devices?.some((device) => device.name === value) ? devices : [{ name: value, description: `${value} (not found now)` }, ...(devices ?? [])];
  return (
    <Row label={label} error={error}>
      <Select aria-label={label} value={value} disabled={disabled || !devices} onChange={(event) => onChange(event.target.value)}>
        {options.map((device) => (
          <option key={device.name} value={device.name}>
            {device.description || device.name}
          </option>
        ))}
      </Select>
    </Row>
  );
}

/** A card control the hub can leave alone (null) or set (0-100 %). */
function CardLevel({
  label,
  hint,
  value,
  disabled,
  error,
  onCommit,
}: {
  label: string;
  hint: string;
  value: number | null;
  disabled: boolean;
  error?: string;
  onCommit: (value: number | null) => void;
}) {
  return (
    <>
      <Row label={label} hint={hint}>
        <Switch label={`Set ${label.toLowerCase()} on the sound card`} checked={value !== null} disabled={disabled} onChange={(on) => onCommit(on ? 70 : null)} />
      </Row>
      {value !== null ? <RangeSetting label={`${label}, % of the card`} value={value} min={0} max={100} format={pct} disabled={disabled} error={error} onCommit={onCommit} /> : null}
    </>
  );
}

export function PttSettingsPanel({ state, canChange, inputLevel }: { state: PttState; canChange: boolean; inputLevel: number | null }) {
  const { settings } = state;
  const update = useUpdatePttSettings();
  const tone = usePttTestTone();
  const devices = usePttDevices(state.audio.device);
  const [local, setLocal] = useState<Errors>({});
  const [advanced, setAdvanced] = useState(false);
  const errors: Errors = { ...(validationFields(update.error) as Errors), ...local };
  const off = !canChange;
  const noAudio = !state.audio.device;

  function change(patch: Partial<PttSettings>) {
    if (off) return;
    const problems = pttSettingsProblems(patch, settings);
    const keys = Object.keys(patch) as Array<keyof PttSettings>;
    setLocal((current) => {
      const next = { ...current };
      keys.forEach((key) => delete next[key]);
      return { ...next, ...problems };
    });
    if (Object.keys(problems).length === 0) update.mutate(patch);
  }

  const range = (key: keyof typeof PTT_RANGES) => ({ min: PTT_RANGES[key].min, max: PTT_RANGES[key].max });

  return (
    <>
      <Panel title="Settings">
        {off ? <Notice>Only the device’s admin can change these.</Notice> : null}
        {/* What the plugin's page showed: where talk comes from and goes, how loud, and the squelch. */}
        <div className={styles.rows}>
          <Row label="Microphone">
            <Segmented
              label="Talk button uses"
              options={[
                { value: 'device', label: 'Device' },
                { value: 'browser', label: 'Browser' },
              ]}
              value={settings.talkInput}
              onChange={(talkInput) => change({ talkInput })}
            />
          </Row>
          <Row label="Play on device" hint="The group on this device’s speaker.">
            <Switch label="Play on device" checked={settings.playOnDevice} disabled={off || noAudio} onChange={(playOnDevice) => change({ playOnDevice })} />
          </Row>
          <RangeSetting label="Volume" value={settings.volume ?? 70} min={0} max={100} format={pct} disabled={off || noAudio} error={errors.volume} onCommit={(volume) => change({ volume })} />
          <RangeSetting label="Mic gain" value={settings.micGain ?? 70} min={0} max={100} format={pct} disabled={off || noAudio} error={errors.micGain} onCommit={(micGain) => change({ micGain })} />
          <Row label="Silence detection" hint="The PTT button only unmutes the microphone: talk goes out while it hears sound.">
            <Switch label="Silence detection" checked={settings.squelchEnabled} disabled={off || noAudio} onChange={(squelchEnabled) => change({ squelchEnabled })} />
          </Row>
          {settings.squelchEnabled ? (
            <RangeSetting
              label="Silence threshold"
              value={settings.squelchOpenDbfs}
              {...range('squelchOpenDbfs')}
              format={dbfs}
              disabled={off || noAudio}
              error={errors.squelchOpenDbfs}
              onCommit={(squelchOpenDbfs) => change({ squelchOpenDbfs })}
            >
              <InputLevel level={inputLevel} threshold={settings.squelchOpenDbfs} />
            </RangeSetting>
          ) : null}
          <Row label="Test tone" hint="One second on this device’s speaker.">
            <Button size="small" busy={tone.isPending} disabled={off || noAudio} onClick={() => tone.mutate()}>
              Play
            </Button>
          </Row>
        </div>
        <FormError error={update.error ?? tone.error} />

        <div className={styles.advanced}>
          <Button size="small" aria-expanded={advanced} aria-controls="ptt-advanced" onClick={() => setAdvanced((open) => !open)}>
            {advanced ? 'Hide advanced' : 'Advanced'}
          </Button>
        </div>
        {advanced ? (
          <div id="ptt-advanced" className={styles.groups}>
            <Group title="Audio">
              <DeviceSelect label="Microphone device" value={settings.captureDevice} devices={devices.data?.capture} disabled={off || noAudio} error={errors.captureDevice} onChange={(captureDevice) => change({ captureDevice })} />
              <DeviceSelect label="Speaker device" value={settings.playbackDevice} devices={devices.data?.playback} disabled={off || noAudio} error={errors.playbackDevice} onChange={(playbackDevice) => change({ playbackDevice })} />
              <CardLevel label="Card volume" hint="Off leaves the sound card as the system set it." value={settings.volume} disabled={off || noAudio} error={errors.volume} onCommit={(volume) => change({ volume })} />
              <CardLevel label="Card mic gain" hint="Off leaves the card’s Capture control alone." value={settings.micGain} disabled={off || noAudio} error={errors.micGain} onCommit={(micGain) => change({ micGain })} />
              <Row label="Receive while talking" hint="No echo canceller between speaker and microphone: use a headset.">
                <Switch label="Receive while talking" checked={settings.rxWhileTx} disabled={off || noAudio} onChange={(rxWhileTx) => change({ rxWhileTx })} />
              </Row>
            </Group>
            <Group title="Hardware PTT">
              <Row label="Arm the microphone" hint="Keep the device microphone open so the hardware button keys the radio.">
                <Switch label="Arm the microphone" checked={settings.autoArm} disabled={off || noAudio} onChange={(autoArm) => change({ autoArm })} />
              </Row>
              <RangeSetting label="Hysteresis" value={settings.squelchHysteresisDb} {...range('squelchHysteresisDb')} format={db} disabled={off || !settings.squelchEnabled} error={errors.squelchHysteresisDb} onCommit={(squelchHysteresisDb) => change({ squelchHysteresisDb })} />
              <RangeSetting label="Hangover" value={settings.squelchHangoverMs} {...range('squelchHangoverMs')} step={50} format={ms} disabled={off || !settings.squelchEnabled} error={errors.squelchHangoverMs} onCommit={(squelchHangoverMs) => change({ squelchHangoverMs })} />
              <RangeSetting label="Pre-roll" value={settings.squelchPrerollMs} {...range('squelchPrerollMs')} step={10} format={ms} disabled={off || !settings.squelchEnabled} error={errors.squelchPrerollMs} onCommit={(squelchPrerollMs) => change({ squelchPrerollMs })} />
            </Group>
            <Group title="Mesh and display">
              <Row label="Relay for others">
                <Switch label="Relay for others" checked={settings.relay} disabled={off} onChange={(relay) => change({ relay })} />
              </Row>
              <Row label="Reach" error={errors.ttl}>
                <Select aria-label="Reach in relays" value={settings.ttl} disabled={off} onChange={(event) => change({ ttl: Number(event.target.value) })}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((ttl) => (
                    <option key={ttl} value={ttl}>
                      {ttl} {ttl === 1 ? 'relay' : 'relays'}
                    </option>
                  ))}
                </Select>
              </Row>
              <Row label="Level animation">
                <Switch label="Level animation" checked={settings.spectrumEnabled} disabled={off} onChange={(spectrumEnabled) => change({ spectrumEnabled })} />
              </Row>
              {settings.spectrumEnabled ? (
                <RangeSetting label="Bars" value={settings.spectrumBands} {...range('spectrumBands')} disabled={off} error={errors.spectrumBands} onCommit={(spectrumBands) => change({ spectrumBands })} />
              ) : null}
            </Group>
            <Group title="Codec (Opus)">
              <RangeSetting label="Bitrate" value={settings.opusBitrateBps} {...range('opusBitrateBps')} step={1000} format={kbps} disabled={off} error={errors.opusBitrateBps} onCommit={(opusBitrateBps) => change({ opusBitrateBps })} />
              <RangeSetting label="Complexity" value={settings.opusComplexity} {...range('opusComplexity')} disabled={off} error={errors.opusComplexity} onCommit={(opusComplexity) => change({ opusComplexity })} />
              <Row label="Shrink pauses (DTX)">
                <Switch label="Shrink pauses (DTX)" checked={settings.opusDtx} disabled={off} onChange={(opusDtx) => change({ opusDtx })} />
              </Row>
              <Row label="In-band FEC">
                <Switch label="In-band FEC" checked={settings.opusFec} disabled={off} onChange={(opusFec) => change({ opusFec })} />
              </Row>
              <RangeSetting label="Expected loss" value={settings.opusPacketLossPct} {...range('opusPacketLossPct')} format={pct} disabled={off} error={errors.opusPacketLossPct} onCommit={(opusPacketLossPct) => change({ opusPacketLossPct })} />
              <Row label="Constant bitrate">
                <Switch label="Constant bitrate" checked={settings.opusCbr} disabled={off} onChange={(opusCbr) => change({ opusCbr })} />
              </Row>
            </Group>
            <Group title="Packets and jitter">
              <RangeSetting label="Frames per packet" value={settings.packetFrames} {...range('packetFrames')} disabled={off} error={errors.packetFrames} onCommit={(packetFrames) => change({ packetFrames })} />
              <RangeSetting label="At most" value={settings.packetFramesMax} {...range('packetFramesMax')} disabled={off} error={errors.packetFramesMax} onCommit={(packetFramesMax) => change({ packetFramesMax })} />
              <Row label="Fill the radio frame">
                <Switch label="Fill the radio frame" checked={settings.packetAlignLdpc} disabled={off} onChange={(packetAlignLdpc) => change({ packetAlignLdpc })} />
              </Row>
              <RangeSetting label="Jitter target" value={settings.jitterTargetMs} {...range('jitterTargetMs')} step={10} format={ms} disabled={off} error={errors.jitterTargetMs} onCommit={(jitterTargetMs) => change({ jitterTargetMs })} />
              <RangeSetting label="Jitter maximum" value={settings.jitterMaxMs} {...range('jitterMaxMs')} step={10} format={ms} disabled={off} error={errors.jitterMaxMs} onCommit={(jitterMaxMs) => change({ jitterMaxMs })} />
            </Group>
          </div>
        ) : null}
      </Panel>
      {advanced ? <PttTestPanel state={state} canChange={canChange} /> : null}
    </>
  );
}

/** The microphone's level against the squelch's open level, while the hub reports one. */
function InputLevel({ level, threshold }: { level: number | null; threshold: number }) {
  if (level === null) return <div className={styles.muted}>The input level shows while the device microphone is keyed.</div>;
  const now = levelDbfs(level);
  const percent = ((now + 90) / 90) * 100;
  const mark = ((threshold + 90) / 90) * 100;
  return (
    <div className={styles.inputLevel} role="meter" aria-label="Microphone level" aria-valuemin={-90} aria-valuemax={0} aria-valuenow={now}>
      <div className={styles.inputFill} data-open={now >= threshold || undefined} style={{ width: `${percent}%` }} />
      <div className={styles.inputMark} style={{ left: `${mark}%` }} />
      <span className="visually-hidden">{now} dBFS</span>
    </div>
  );
}
