import { X } from 'lucide-react';
import { errorMessage, type NodeJob, type NodeJobKind } from '@/api';
import { useCancelJob } from '@/data/queries';
import { Button, Status, type Tone } from '@/ui';
import styles from './jobs.module.css';

/* How a job on another node is talked about and shown, wherever it appears. */

export const JOB_NAMES: Record<NodeJobKind, string> = { update: 'Software update', radio: 'Radio change', restart: 'Restart', ptt: 'Talk settings' };

export const isActive = (job: NodeJob) => job.state === 'queued' || job.state === 'running';

/** The job to show for each node: one that is under way if there is one, else the most recent. */
export function currentJobs(jobs: readonly NodeJob[]): Map<string, NodeJob> {
  const byNode = new Map<string, NodeJob>();
  for (const job of jobs) {
    const shown = byNode.get(job.nodeId);
    if (!shown || (isActive(job) && !isActive(shown)) || (isActive(job) === isActive(shown) && job.createdTs >= shown.createdTs)) byNode.set(job.nodeId, job);
  }
  return byNode;
}

const TONE: Record<NodeJob['state'], Tone> = { queued: 'neutral', running: 'accent', done: 'ok', failed: 'danger' };

/** A job in two or three words, for a table cell: "Updating 40%", "Restart queued", "Radio failed". */
const SHORT: Record<NodeJob['kind'], Record<NodeJob['state'], string>> = {
  update: { queued: 'Update queued', running: 'Updating', done: 'Updated', failed: 'Update failed' },
  radio: { queued: 'Radio queued', running: 'Setting radio', done: 'Radio set', failed: 'Radio failed' },
  restart: { queued: 'Restart queued', running: 'Restarting', done: 'Restarted', failed: 'Restart failed' },
  ptt: { queued: 'Talk queued', running: 'Setting talk', done: 'Talk set', failed: 'Talk failed' },
};

/**
 * One line for a job, and a bar while it runs. `compact` is the short form for
 * a table cell, where the full reason for a failure is in the tooltip.
 */
export function JobStatus({ job, compact }: { job: NodeJob; compact?: boolean }) {
  const cancel = useCancelJob();
  const percent = Math.round(job.progress * 100);
  // An update runs in the background for minutes: it can be stopped, and keeps what the node has.
  const stoppable = job.kind === 'update' && isActive(job);
  const gradual = job.state === 'running' && job.kind === 'update';
  const text = compact ? `${SHORT[job.kind][job.state]}${gradual ? ` ${percent}%` : ''}` : `${job.detail}${gradual ? `, ${percent}%` : ''}`;
  return (
    <span className={styles.job} title={compact ? `${JOB_NAMES[job.kind]}: ${job.detail}` : undefined}>
      <Status tone={TONE[job.state]}>{text}</Status>
      {job.state === 'running' ? (
        <span className={styles.track} role="progressbar" aria-label={JOB_NAMES[job.kind]} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span className={styles.fill} style={{ width: `${percent}%` }} />
        </span>
      ) : null}
      {stoppable ? (
        <Button
          size="small"
          variant="ghost"
          iconOnly
          aria-label="Stop the update"
          title={cancel.isError ? errorMessage(cancel.error) : 'Stop the update'}
          busy={cancel.isPending}
          onClick={() => cancel.mutate(job.id)}
        >
          <X size={14} aria-hidden />
        </Button>
      ) : null}
    </span>
  );
}
