import type { BootSlotId, OsJob, OsState, OsUpdate } from '../types';
import { ApiError } from '../errors';

/*
 * The mock's OS updates: slot A starts with image 0.3.3. A file is taken when it is named like a
 * release bundle for this board (image-stm32mp1-kaonic1s-r30-v<version>-emmc.tar.gz);
 * uploading, checking and installing each take a few seconds, like on a board.
 */

const MACHINE = 'stm32mp1-kaonic1s-r30';
let running = '0.3.3';

const parts = (version: string) => version.split('.').map((part) => Number.parseInt(part, 10) || 0);

export function compareVersions(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  for (let index = 0; index < Math.max(x.length, y.length); index++) {
    const difference = (x[index] ?? 0) - (y[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

/** What the hub would find in a bundle with this name: its version, or why it is refused. */
export function inspectBundle(name: string): { version: string } | { error: string } {
  const match = /^image-(.+)-v(\d+(?:\.\d+)*)-(emmc|sdcard-usb|sdcard-raw)\.tar\.gz$/.exec(name);
  if (!match) return { error: 'This is not a Kaonic image bundle: it has no manifest.toml.' };
  const [, machine, version, kind] = match;
  if (machine !== MACHINE) return { error: `This image is for ${machine}, and this device is ${MACHINE}.` };
  if (kind !== 'emmc') return { error: `This is the ${kind} bundle; use the eMMC one (…-emmc.tar.gz).` };
  return { version: version! };
}

export function createMockOs(checkPassword: (password: string) => void) {
  let update: OsUpdate | null = null;
  const jobs = new Map<string, OsJob>();
  const newJob = (detail: string): OsJob => {
    const job: OsJob = { id: Math.random().toString(16).slice(2, 18), state: 'running', progress: 0, detail, error: null };
    jobs.set(job.id, job);
    return job;
  };
  /** Moves a job from 0 to 1 over `ms`, then calls `done`. */
  function run(job: OsJob, ms: number, detail: (progress: number) => string, done: () => void) {
    const started = Date.now();
    const timer = setInterval(() => {
      job.progress = Math.min(1, (Date.now() - started) / ms);
      job.detail = detail(job.progress);
      if (job.progress >= 1) {
        clearInterval(timer);
        done();
      }
    }, 150);
  }

  const busy = () => update !== null && (update.state === 'uploading' || update.state === 'checking' || update.state === 'installing');

  return {
    state: (): OsState => ({ version: running, os: 'kaonic-os 2026.09', machine: MACHINE, storage: 'emmc', slot: 'a', update: update ? { ...update } : null }),

    async upload(file: Blob, onProgress: (fraction: number) => void): Promise<OsJob> {
      if (busy()) throw new ApiError('conflict', 'An update is already being uploaded, checked or installed.');
      const name = file instanceof File ? file.name : '';
      update = { state: 'uploading', size: file.size, uploadedTs: Math.floor(Date.now() / 1000), jobId: null, version: null, built: null, compared: null, error: null, slot: null };
      for (let step = 1; step <= 20; step++) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        onProgress(step / 20);
      }
      const job = newJob('Checking the image');
      const current = update;
      current.state = 'checking';
      current.jobId = job.id;
      run(job, 2500, () => 'Checking the image', () => {
        const found = inspectBundle(name);
        current.jobId = null;
        if ('error' in found) {
          job.state = 'failed';
          job.error = found.error;
          current.state = 'invalid';
          current.error = found.error;
          return;
        }
        job.state = 'done';
        const order = compareVersions(found.version, running);
        Object.assign(current, { state: 'ready', version: found.version, built: new Date().toISOString().slice(0, 19) + 'Z', compared: order > 0 ? 'newer' : order === 0 ? 'same' : 'older' });
      });
      return { ...job };
    },

    discard() {
      if (update?.state === 'installing' || update?.state === 'uploading') throw new ApiError('conflict', 'The update is being installed.');
      update = null;
    },

    install(password: string): OsJob {
      if (update?.state !== 'ready') throw new ApiError('conflict', 'Upload an image and wait for it to be checked first.');
      checkPassword(password);
      const current = update;
      const slot: BootSlotId = 'b';
      const job = newJob('Preparing');
      Object.assign(current, { state: 'installing', jobId: job.id, slot });
      run(job, 7000, (progress) => (progress < 0.1 ? 'Writing the boot partition' : progress < 0.8 ? 'Writing the system partition' : progress < 0.98 ? 'Checking what was written' : 'Finishing'), () => {
        job.state = 'done';
        job.detail = null;
        Object.assign(current, { state: 'installed', jobId: null });
      });
      return { ...job };
    },

    /** A restart starts an installed update. */
    rebooted() {
      if (update?.state === 'installed' && update.version) running = update.version;
      if (update?.state !== 'uploading' && update?.state !== 'checking') update = null;
    },

        job(id: string): OsJob {
      const job = jobs.get(id);
      if (!job) throw new ApiError('not_found', 'No such job.');
      return { ...job };
    },
  };
}
