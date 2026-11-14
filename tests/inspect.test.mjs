import test from 'node:test';
import assert from 'node:assert/strict';
import {STATES,validateTrace,inspectTrace,toMarkdown} from '../src/inspect.mjs';

const now='2026-11-14T12:30:00Z';
const policy={ackDeadlineMs:60000,staleAfterMs:120000,maxDeliveries:3};
const evt=(id,state,minute=0,operationId='op-1',extra={})=>({
 id,at:'2026-11-14T12:'+String(minute).padStart(2,'0')+':00Z',
 tenant:'demo',route:'invoices',operationId,deliveryId:'d-1',state,
 ...(state==='effect_committed'?{effectId:'effect-1'}:{}),...extra
});
const run=(events,override={})=>inspectTrace({asOf:now,policy,events,...override});
const codes=r=>r.findings.map(x=>x.code);
test('all seven supported states are distinct',()=>assert.equal(new Set(STATES).size,7));
test('empty supplied trace produces no flags',()=>{
 const r=run([]);assert.equal(r.summary.events,0);assert.equal(r.summary.operations,0);
 assert.equal(r.findings.length,0);assert.equal(r.state,'SUPPLIED_RECORDS_ONLY');
});
test('happy path receipt, commit, ack has no flags',()=>{
 const r=run([evt('e1','received'),evt('e2','effect_committed',1),evt('e3','acknowledged',2)]);
 assert.equal(r.operations[0].status,'ACK_RECORDED');assert.equal(r.summary.high,0);
});
test('duplicate received same delivery is informational only',()=>{
 const r=run([evt('e1','received'),evt('e2','received',1),evt('e3','effect_committed',2),evt('e4','acknowledged',3)]);
 assert.ok(codes(r).includes('REPEATED_DELIVERY'));assert.equal(r.summary.high,0);
 assert.equal(r.operations[0].distinctEffects,1);
});
test('distinct effects on same operation are high priority',()=>{
 const r=run([evt('e1','received'),evt('e2','effect_committed',1),
   evt('e3','effect_committed',2,'op-1',{effectId:'effect-2'})]);
 assert.ok(codes(r).includes('DUPLICATE_EFFECTS'));assert.equal(r.summary.potentialDuplicateEffects,1);
 assert.equal(r.operations[0].status,'POTENTIAL_DUPLICATE_EFFECTS');
});
test('same effect ID repeated is not a duplicate business effect',()=>{
 const r=run([evt('e1','effect_committed',1),evt('e2','effect_committed',2)]);
 assert.ok(codes(r).includes('REPEATED_COMMIT_RECORD'));
 assert.equal(r.summary.potentialDuplicateEffects,0);
});
test('commit without acknowledgement after threshold flags high',()=>{
 const r=run([evt('e1','received'),evt('e2','effect_committed',1)]);
 assert.ok(codes(r).includes('COMMIT_NOT_ACKNOWLEDGED'));assert.equal(r.summary.overdueAcknowledgements,1);
});
test('commit inside the configured grace window is pending',()=>{
 const r=run([evt('e1','effect_committed',29)],{policy:{...policy,ackDeadlineMs:120000}});
 assert.equal(r.summary.overdueAcknowledgements,0);assert.equal(r.operations[0].status,'ACK_PENDING_WITHIN_WINDOW');
});
test('ack exactly at latest commit is accepted',()=>{
 const r=run([evt('e1','effect_committed',1),evt('e2','acknowledged',1)]);
 assert.equal(r.summary.overdueAcknowledgements,0);assert.equal(r.operations[0].status,'ACK_RECORDED');
});
test('old ack cannot close later commit',()=>{
 const r=run([evt('e1','effect_committed',1),evt('e2','acknowledged',2),
   evt('e3','effect_committed',3,'op-1',{effectId:'effect-2'})]);
 assert.ok(codes(r).includes('ACK_BEFORE_COMMIT'));
 assert.ok(codes(r).includes('COMMIT_NOT_ACKNOWLEDGED'));
 assert.equal(r.summary.overdueAcknowledgements,1);
});
test('ack with no commit requires review, not high',()=>{
 const r=run([evt('e1','received'),evt('e2','acknowledged',1)]);
 assert.ok(codes(r).includes('ACK_WITHOUT_COMMIT'));assert.equal(r.summary.high,0);assert.equal(r.operations[0].status,'ACK_WITHOUT_COMMIT');
});
test('stale open operation flagged',()=>{
 const r=run([evt('e1','received'),evt('e2','started',1)]);
 assert.equal(r.summary.staleOperations,1);assert.ok(codes(r).includes('STALE_UNRESOLVED'));
});
test('recent uncommitted record not yet stale',()=>{
 const r=run([evt('e1','received',29)]);
 assert.equal(r.summary.staleOperations,0);assert.equal(r.operations[0].status,'IN_PROGRESS_OR_INCOMPLETE');
});
test('dead letter is review not silently closed',()=>{
 const r=run([evt('e1','received'),evt('e2','failed',1),evt('e3','dead_lettered',2)]);
 assert.ok(codes(r).includes('DEAD_LETTERED'));assert.equal(r.summary.high,0);
});
test('reconciled after dead letter prevents dead-letter flag',()=>{
 const r=run([evt('e1','received'),evt('e2','dead_lettered',1),evt('e3','reconciled',2)]);
 assert.ok(!codes(r).includes('DEAD_LETTERED'));assert.equal(r.operations[0].status,'RECONCILED_RECORDED');
});
test('failed after commit prompts review',()=>{
 const r=run([evt('e1','effect_committed',1),evt('e2','failed',2)]);
 assert.ok(codes(r).includes('FAILURE_AFTER_COMMIT'));
});
test('delivery count > budget prompts review',()=>{
 const r=run([evt('e1','received'),evt('e2','received',1),evt('e3','received',2),evt('e4','received',3)]);
 assert.ok(codes(r).includes('DELIVERY_BUDGET_EXCEEDED'));
});
test('budget boundary is inclusive and not exceeded',()=>{
 const r=run([evt('e1','received'),evt('e2','received',1),evt('e3','received',2)]);
 assert.ok(!codes(r).includes('DELIVERY_BUDGET_EXCEEDED'));
});
test('duplicate ack is informational',()=>{
 const r=run([evt('e1','effect_committed'),evt('e2','acknowledged',1),evt('e3','acknowledged',2)]);
 assert.ok(codes(r).includes('REPEATED_ACK'));assert.equal(r.summary.high,0);
});
test('commit without a received record needs review',()=>{
 const r=run([evt('e1','effect_committed',1)]);
 assert.ok(codes(r).includes('COMMIT_WITHOUT_RECEIPT'));
});
test('input ordering warning does not block grouped interpretation',()=>{
 const r=run([evt('e1','acknowledged',2),evt('e2','effect_committed',1),evt('e3','received',0)]);
 assert.ok(codes(r).includes('INPUT_ORDER_DIFFERS'));assert.equal(r.operations[0].status,'ACK_RECORDED');
});
test('tenant scopes separate identical operation IDs',()=>{
 const r=run([evt('e1','effect_committed',1),evt('e2','effect_committed',1,'op-1',{tenant:'other',effectId:'other-eff'})]);
 assert.equal(r.summary.operations,2);assert.equal(r.summary.potentialDuplicateEffects,0);
});
test('route scopes separate identical operation IDs',()=>{
 const r=run([evt('e1','effect_committed',1),evt('e2','effect_committed',1,'op-1',{route:'refunds',effectId:'other-eff'})]);
 assert.equal(r.summary.operations,2);assert.equal(r.summary.potentialDuplicateEffects,0);
});
test('same effect ID across separate operations not conflated',()=>{
 const r=run([evt('e1','effect_committed',1,'op-1'),evt('e2','effect_committed',1,'op-2')]);
 assert.equal(r.summary.potentialDuplicateEffects,0);
});
test('event ID duplicates rejected instead of silently deduped',()=>assert.throws(()=>run([evt('e1','received'),evt('e1','failed')]),/Duplicate event ID/));
test('unknown event state rejected',()=>assert.throws(()=>run([evt('e1','settled')]),/Unknown state/));
test('commit requires effect ID',()=>assert.throws(()=>run([evt('e1','effect_committed',1,'op-1',{effectId:undefined})]),/unique effectId/));
test('effect ID forbidden on non-commit state',()=>assert.throws(()=>run([evt('e1','received',0,'op-1',{effectId:'x'})]),/only valid/));
test('asOf must contain offset',()=>assert.throws(()=>run([],{asOf:'2026-11-14T12:30:00'}),/explicit timezone/));
test('future event rejected',()=>assert.throws(()=>run([evt('e1','received',31)]),/falls after/));
test('invalid timestamp rejected',()=>assert.throws(()=>run([evt('e1','received',0,'op-1',{at:'not-a-date'})]),/explicit timezone/));
test('unsupported root field rejected',()=>assert.throws(()=>run([],{token:'private'}),/Unexpected field trace.token/));
test('unsupported event field rejected',()=>assert.throws(()=>run([evt('e1','received',0,'op-1',{payload:{secret:'x'}})]),/Unexpected field event.payload/));
test('invalid identifier rejected',()=>assert.throws(()=>run([evt('bad id','received')]),/safe identifier/));
test('non-array events rejected',()=>assert.throws(()=>run('bad'),/events must be/));
test('over 500 events rejected',()=>{
 const e=Array.from({length:501},(_,i)=>evt('e'+i,'received'));
 assert.throws(()=>run(e),/at most 500/);
});
test('policy ack deadline lower bound',()=>assert.throws(()=>run([],{policy:{...policy,ackDeadlineMs:0}}),/ackDeadlineMs/));
test('policy stale threshold upper bound',()=>assert.throws(()=>run([],{policy:{...policy,staleAfterMs:2592000001}}),/staleAfterMs/));
test('policy delivery budget zero rejected',()=>assert.throws(()=>run([],{policy:{...policy,maxDeliveries:0}}),/maxDeliveries/));
test('invalid policy unknown field rejected',()=>assert.throws(()=>run([],{policy:{...policy,secret:'x'}}),/Unexpected field policy.secret/));
test('JSON input matches object input',()=>{
 const obj={asOf:now,policy,events:[evt('e1','received')]};
 assert.deepEqual(inspectTrace(obj),inspectTrace(JSON.stringify(obj)));
});
test('deterministic output across identical calls',()=>assert.deepEqual(run([evt('e1','received')]),run([evt('e1','received')])));
test('summary levels reconcile with findings',()=>{
 const r=run([evt('e1','effect_committed')]);
 assert.equal(r.summary.high+r.summary.review+r.summary.info,r.findings.length);
});
test('markdown contains operations, findings and limits',()=>{
 const md=toMarkdown(run([evt('e1','effect_committed')]));
 for(const part of ['Integration delivery trace','COMMIT_NOT_ACKNOWLEDGED','No live integration tested','## Limits'])assert.ok(md.includes(part));
});
test('markdown rejects alien report',()=>assert.throws(()=>toMarkdown({}),/Expected a delivery trace report/));
test('outputs exclude event payload data and private records',()=>{
 const r=run([evt('e1','received')]);
 assert.ok(!JSON.stringify(r).includes('payload'));
 assert.match(r.limitations,/No ingestion, live monitoring/);
});
test('supplied trace arrays do not mutate',()=>{
 const records=[evt('e1','received'),evt('e2','effect_committed',2)];
 const before=JSON.stringify(records);run(records);assert.equal(JSON.stringify(records),before);
});
test('multiple distinct effects and overdue ack both counted',()=>{
 const r=run([evt('e1','received'),evt('e2','effect_committed',1),evt('e3','effect_committed',2,'op-1',{effectId:'fx-2'})]);
 assert.equal(r.summary.potentialDuplicateEffects,1);assert.equal(r.summary.overdueAcknowledgements,1);
});
