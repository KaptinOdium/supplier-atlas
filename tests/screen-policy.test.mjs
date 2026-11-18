import test from 'node:test';
import assert from 'node:assert/strict';
import {assessIncident, projectAssessment} from '../docs/screen-policy.mjs';

const policy = {maxEvidenceAgeDays:3,normalLeadWeekdays:3,severeLeadCalendarDays:7};
const match = {kind:'company-city',decision:'candidate',event:{date:'2026-11-23',category:'strike',lastChecked:'2026-11-18'}};
test('uses the owner policy and counts weekdays across a weekend', () => {
  assert.equal(projectAssessment(match,null,'2026-11-18'),'');
  assert.match(projectAssessment(match,policy,'2026-11-18'),/procurement exposure/);
  const later = {...match,event:{...match.event,date:'2026-11-24'}};
  assert.match(projectAssessment(later,policy,'2026-11-18'),/window/);
  assert.match(projectAssessment({...later,event:{...later.event,screening:{severe:true}}},policy,'2026-11-18'),/procurement exposure/);
});
test('stale and area-only evidence cannot clear escalation gates', () => {
  assert.match(projectAssessment(match,policy,'2026-11-24'),/Reconfirm/);
  assert.match(projectAssessment({...match,kind:'locality'},policy,'2026-11-18'),/local site/);
});

test('the observation date of an ongoing non-strike incident is not its end date', () => {
  const event = {category:'production outage',state:'ongoing',date:'2026-10-31',
    lastChecked:'2026-11-18',screening:{decision:'internal',reason:'Plant operator confirmed continued disruption.'}};
  for (const [fields, expected] of [[{},'internal'],[{state:'recovery'},'closed'],[{lastChecked:'2026-11-14'},'excluded']])
    assert.equal(assessIncident({...event,...fields},policy,'2026-11-18').decision,expected);
});

test('screen each strike interval individually for a continuous 24 hours or a documented material impact', () => {
  const event = {...match.event,state:'announced',date:'2026-11-19'};
  for (const [fields, expected] of [[{continuousHours:5},'excluded'],[{},'watch'],[{continuousHours:24},'candidate'],
    [{continuousHours:2,operationalImpactVerified:true},'candidate']])
    assert.equal(assessIncident({...event,screening:{decision:'candidate',...fields}},policy,'2026-11-18').decision,expected);
});
