function parse(value, fallback = 0) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function advanceSchedule(schedule, now, status, config) {
  const current = parse(schedule.nextRunAt, now);
  let next = current + schedule.intervalMs;
  if (next <= now) {
    if (now - next > config.maxCatchUpMs) next = now + schedule.intervalMs;
    else next = now + schedule.intervalMs;
  }
  return {...schedule, lastRunAt: now, lastStatus: status, nextRunAt: new Date(next).toISOString()};
}

export function dueSchedules(state, now = Date.now(), config) {
  if (state.control.paused) return {due: [], skipped: [], nextRunAt: null};
  const due = [], skipped = [];
  for (const schedule of state.schedules) {
    if (!schedule.enabled) continue;
    const next = parse(schedule.nextRunAt, now);
    if (next > now) continue;
    if (now - next > config.maxCatchUpMs) {
      skipped.push({id: schedule.id, activity: schedule.activity, nextRunAt: schedule.nextRunAt, reason: 'missed-window-coalesced'});
      continue;
    }
    due.push({...schedule, plannedAt: new Date(now).toISOString()});
  }
  const future = state.schedules
    .filter((schedule) => schedule.enabled && parse(schedule.nextRunAt, now) > now)
    .map((schedule) => schedule.nextRunAt)
    .sort();
  return {due, skipped, nextRunAt: future[0] || null};
}

export function applyCoalescedSkip(state, skipped, config, now = new Date().toISOString()) {
  for (const item of skipped) {
    const schedule = state.schedules.find((entry) => entry.id === item.id);
    if (!schedule) continue;
    schedule.nextRunAt = new Date(Date.parse(now) + schedule.intervalMs).toISOString();
    schedule.lastStatus = 'deferred';
  }
  return state;
}

export function nextRunAt(state) {
  const values = state.schedules.filter((schedule) => schedule.enabled).map((schedule) => schedule.nextRunAt).sort();
  return values[0] || null;
}
