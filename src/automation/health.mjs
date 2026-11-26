import {usageSummary} from '../newsroom/budget.mjs';
import {readOperationalStateWithHash, verifyOperationalDatabase} from '../storage/operational.mjs';
import {inspectJournal} from './recovery.mjs';
import {jobsToday} from './state.mjs';

export function automationHealth(repository, root) {
  const state = repository.read();
  const verified = verifyOperationalDatabase(root);
  const newsroom = readOperationalStateWithHash(root, 'newsroom').state;
  const usage = usageSummary(newsroom, repository.now());
  const journal = inspectJournal(root);
  const open = state.jobs.filter((job) => ['queued', 'running', 'recovery-required'].includes(job.status));
  return {
    backend: verified.marker.backend,
    schemaVersion: verified.schemaVersion,
    integrity: verified.integrity,
    databaseBytes: verified.databaseBytes,
    automation: {
      paused: state.control.paused,
      nextRunAt: state.schedules.filter((schedule) => schedule.enabled).map((schedule) => schedule.nextRunAt).sort()[0] || null,
      lastRunAt: state.control.lastRunAt,
      lastBackupAt: state.control.lastBackupAt,
      openJobs: open.length,
      failureJobs: state.jobs.filter((job) => job.status === 'failed').length,
      blockedJobs: state.jobs.filter((job) => job.status === 'blocked').length,
      recoveryRequired: state.jobs.filter((job) => job.status === 'recovery-required').length,
      jobsToday: jobsToday(state),
    },
    budget: {
      dayTokens: usage.dayTokens,
      monthTokens: usage.monthTokens,
      maxDailyTokens: repository.config.maxDailyTokens,
      remaining: Math.max(0, repository.config.maxDailyTokens - usage.dayTokens),
      calls: usage.calls,
      incomplete: usage.incomplete,
    },
    journal,
    imagesPending: verified.metrics.statuses?.images?.['image-pending'] || 0,
    automaticApproval: false,
    automaticPublication: false,
  };
}
