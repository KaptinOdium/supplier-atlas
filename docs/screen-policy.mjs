const DAY = 86400000;
export const decisionNames = Object.freeze({
  candidate: 'Check exposure', internal: 'Internal review', watch: 'Monitor',
  unreviewed: 'Check', excluded: 'Noreply', closed: 'Closed'
});
const defaults = {maxEvidenceAgeDays: 3, normalLeadWeekdays: 3, severeLeadCalendarDays: 7};
const closedStates = new Set(['ended','past','cancelled','suspended','postponed','closed','recovery','resolved','resumed']);
function utcDay(value) {
  const text = typeof value === 'string' ? value.slice(0,10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(text+'T00:00:00Z') : NaN;
}

// Apply the project's time and evidence gates before linking a reviewed
// incident to a supplier. Observation dates alone do not close open incidents.
export function assessIncident(event, policy, today, clock = Date.now()) {
  const saved = event.screening || {};
  const result = (decision, reason) => ({decision, reason});
  if (closedStates.has(event.state) || saved.decision === 'closed') return result('closed', saved.reason || 'Operations resumed or the action ended.');
  if (saved.decision === 'excluded') return result('excluded', saved.reason || 'Outside screening scope.');
  const start = utcDay(event.date), end = utcDay(event.endDate);
  const now = utcDay(today), checked = utcDay(event.lastChecked || event.reviewedAt);
  if (end < now || Date.parse(event.endAt) <= clock ||
      (event.category === 'strike' && event.state === 'announced' && start < now && !Number.isFinite(end) && !event.endAt))
    return result('closed','The published action window has passed.');
  const limits = {...defaults, ...policy};
  if (!Number.isFinite(checked) || checked > now || now - checked > limits.maxEvidenceAgeDays * DAY)
    return result('excluded','Current operational impact needs fresh evidence.');
  if (event.category === 'strike') {
    // Use one continuous interval. Dates alone do not establish a 24-hour stoppage.
    const hours = Number.isFinite(saved.continuousHours) ? saved.continuousHours :
      (Date.parse(event.endAt) - Date.parse(event.startAt)) / 3600000;
    if (Number.isFinite(hours) && hours < 24 && saved.operationalImpactVerified !== true)
      return result('excluded','A short action has no verified material disruption.');
    if (!Number.isFinite(hours) && saved.operationalImpactVerified !== true && ['candidate','internal'].includes(saved.decision))
      return result('watch','Verify continuous stoppage duration or material production or delivery impact.');
  }
  if (start > now && (saved.severe === true ? (start-now)/DAY > limits.severeLeadCalendarDays :
      weekdaysUntil(now,start) > limits.normalLeadWeekdays))
    return result('watch','Monitor until the preventive screening window opens.');
  if (saved.decision && Object.hasOwn(decisionNames, saved.decision))
    return result(saved.decision, saved.reason || 'Check current evidence.');
  return result('unreviewed','Check the affected site and corroborate operational impact.');
}

function weekdaysUntil(now, target) {
  const days = Math.round((target-now)/DAY);
  let weekdays = Math.floor(days/7)*5;
  for (let d = days - days%7 + 1; d <= days; d++) {
    const weekday = new Date(now + d*DAY).getUTCDay();
    if (weekday !== 0 && weekday !== 6) weekdays++;
  }
  return weekdays;
}

// Project-specific thresholds and procurement checks come from the member's
// private register. This assesses a lead independently of the upstream decision.
export function projectAssessment(match, policy, today) {
  if (!policy || !Number.isInteger(policy.maxEvidenceAgeDays)) return '';
  const event = match.event;
  const now = utcDay(today);
  const checked = utcDay(event.lastChecked || event.reviewedAt);
  const start = utcDay(event.date);
  const saved = event.screening || {};
  if (!Number.isFinite(checked) || now - checked > policy.maxEvidenceAgeDays * DAY)
    return 'Reconfirm the event and continuing impact before escalation.';
  if (start > now) {
    const severe = saved.severe === true;
    const within = severe ? (start-now)/DAY <= policy.severeLeadCalendarDays :
      weekdaysUntil(now,start) <= policy.normalLeadWeekdays;
    if (!within) return 'Monitor until the project’s preventive screening window opens.';
  }
  if (match.kind === 'locality') return 'Check the local site, access or freight impact with an operator or authority.';
  if (match.kind === 'company-only') return 'Verify the affected legal entity and operating site before checking procurement exposure.';
  if (saved.operationalImpactVerified === true && saved.exposureVerified !== true)
    return 'Check current procurement exposure for this legal entity and site before a buyer alert.';
  if (match.decision === 'watch' || match.decision === 'unreviewed')
    return 'Monitor and corroborate operational impact before a buyer alert.';
  if (saved.exposureVerified !== true || saved.operationalImpactVerified !== true || saved.buyerActionVerified !== true)
    return 'Internal review required. Confirm current procurement exposure, operational impact and a buyer action.';
  return start > now ? 'Preventive review. Confirm the buyer can act before the expected impact.' :
    'Reactive review. Confirm the documented disruption and buyer action.';
}
