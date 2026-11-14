// Original deterministic, offline inspection of supplied synthetic delivery history.
// No real provider records, network access, live status or certification.
export const STATES=Object.freeze(['received','started','effect_committed','acknowledged','failed','dead_lettered','reconciled']);
const allowedEventFields=new Set(['id','at','tenant','route','operationId','deliveryId','state','effectId']);
const allowedRootFields=new Set(['asOf','policy','events']);
const allowedPolicyFields=new Set(['ackDeadlineMs','staleAfterMs','maxDeliveries']);
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const idPattern=/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,95}$/;
function ident(value,name){
 if(typeof value!=='string'||!idPattern.test(value))throw Error(name+' must be 1–96 safe identifier characters.');
 return value;
}
function integer(value,name,min,max){
 if(!Number.isSafeInteger(value)||value<min||value>max)
   throw Error(name+' must be a whole number from '+min+' to '+max+'.');
 return value;
}
function date(value,label){
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value))
   throw Error(label+' must be ISO 8601 with an explicit timezone.');
 const n=Date.parse(value);
 if(!Number.isFinite(n))throw Error(label+' must be a real timestamp.');
 return n;
}
function onlyFields(value,allowed,label){
 for(const key of Object.keys(value))if(!allowed.has(key))
   throw Error('Unexpected field '+label+'.'+key+'. Only synthetic structural identifiers are accepted.');
}
export function validateTrace(input){
 const data=typeof input==='string'?JSON.parse(input):input;
 if(!isObject(data))throw Error('Expected a trace object.');
 onlyFields(data,allowedRootFields,'trace');
 const asOf=date(data.asOf,'asOf');
 if(!isObject(data.policy))throw Error('policy must be an object.');
 onlyFields(data.policy,allowedPolicyFields,'policy');
 const ackDeadlineMs=integer(data.policy.ackDeadlineMs, 'ackDeadlineMs',1,2592000000);
 const staleAfterMs=integer(data.policy.staleAfterMs,'staleAfterMs',1,2592000000);
 const maxDeliveries=integer(data.policy.maxDeliveries,'maxDeliveries',1,50);
 if(!Array.isArray(data.events)||data.events.length>500)throw Error('events must be an array of at most 500 records.');
 const events=[],ids=new Set();
 data.events.forEach((e,index)=>{
  if(!isObject(e))throw Error('Event '+index+' must be an object.');
  onlyFields(e,allowedEventFields,'event');
  const id=ident(e.id,'event.id');
  if(ids.has(id))throw Error('Duplicate event ID '+id+'; fix source data before interpreting a trace.');
  ids.add(id);
  const at=date(e.at,'event.at');
  if(at>asOf)throw Error('Event '+id+' falls after the fixed asOf timestamp.');
  if(!STATES.includes(e.state))throw Error('Unknown state for event '+id+'.');
  const record={
   id, at, timestamp:new Date(at).toISOString(),
   tenant:ident(e.tenant,'tenant'),route:ident(e.route,'route'),
   operationId:ident(e.operationId,'operationId'),
   deliveryId:ident(e.deliveryId,'deliveryId'),
   state:e.state,
   effectId:e.effectId===undefined?null:ident(e.effectId,'effectId'),
   inputIndex:index
  };
  if(record.state==='effect_committed'&&!record.effectId)throw Error('effect_committed must include a unique effectId.');
  if(record.state!=='effect_committed'&&record.effectId!==null)throw Error('effectId is only valid on effect_committed records.');
  events.push(record);
 });
 return {asOf,asOfIso:new Date(asOf).toISOString(),policy:{ackDeadlineMs,staleAfterMs,maxDeliveries},events};
}
const severityRank={HIGH:0,REVIEW:1,INFO:2};
const actionFor={
 DUPLICATE_EFFECTS:'Reconcile the distinct effect IDs and require atomic, tenant-scoped idempotent admission before writes.',
 COMMIT_NOT_ACKNOWLEDGED:'Investigate the missing acknowledgement and compare durable commit, send and receipt state before retrying.',
 ACK_WITHOUT_COMMIT:'Confirm whether acknowledgement of an uncommitted/no-op request is legitimate for this provider.',
 ACK_BEFORE_COMMIT:'Investigate the ordering; an earlier acknowledgement does not prove the later recorded commit was acknowledged.',
 DELIVERY_BUDGET_EXCEEDED:'Inspect retry scheduling, provider delivery guarantees, and deduplication behavior.',
 STALE_UNRESOLVED:'Inspect recovery, dead-letter queues and reconciliation with a durable operation ledger.',
 DEAD_LETTERED:'Review the dead-letter queue and verify a bounded manual repair path exists.',
 COMMIT_WITHOUT_RECEIPT:'Confirm the producer or ingest stage was recorded and that this effect is authorized.',
 FAILURE_AFTER_COMMIT:'Check whether failure describes transport/acknowledgement, not a rollback of committed work.',
 REPEATED_DELIVERY:'Check that repeated deliveries map to the same intended operation and do not repeat business effects.',
 REPEATED_COMMIT_RECORD:'Confirm repeated records of the same effectId are telemetry duplicates, not different effects.',
 REPEATED_ACK:'Confirm duplicate acknowledgement records are only duplicate telemetry.',
 INPUT_ORDER_DIFFERS:'Check upstream event-log ordering and normalize by event timestamp before interpretation.'
};
export function inspectTrace(input){
 const {asOf,asOfIso,policy,events}=validateTrace(input);
 const groups=new Map();
 for(const e of events){
  const key=JSON.stringify([e.tenant,e.route,e.operationId]);
  if(!groups.has(key))groups.set(key,{key,tenant:e.tenant,route:e.route,operationId:e.operationId,events:[]});
  groups.get(key).events.push(e);
 }
 const findings=[];
 const add=(group,code,severity,explanation,sourceEvents=[])=>{
  findings.push({
   id:'F-'+String(findings.length+1).padStart(3,'0'),
   operationId:group?.operationId??null,
   scope:group?{tenant:group.tenant,route:group.route}:null,
   code,severity,explanation,action:actionFor[code],
   eventIds:sourceEvents.map(e=>e.id)
  });
 };
 if(events.some((e,i)=>i>0&&e.at<events[i-1].at))
  add(null,'INPUT_ORDER_DIFFERS','INFO','Input records were not in time order; analysis sorted each operation by its timestamp.');
 const operations=[];
 for(const group of groups.values()){
  const evs=[...group.events].sort((a,b)=>a.at-b.at||a.inputIndex-b.inputIndex);
  const received=evs.filter(e=>e.state==='received');
  const commits=evs.filter(e=>e.state==='effect_committed');
  const ack=evs.filter(e=>e.state==='acknowledged');
  const failed=evs.filter(e=>e.state==='failed');
  const dead=evs.filter(e=>e.state==='dead_lettered');
  const reconciled=evs.filter(e=>e.state==='reconciled');
  const uniqueEffects=[...new Set(commits.map(e=>e.effectId))];
  const deliveryCounts=new Map();
  for(const e of received)deliveryCounts.set(e.deliveryId,(deliveryCounts.get(e.deliveryId)??0)+1);
  const repeatedDeliveries=received.filter(e=>(deliveryCounts.get(e.deliveryId)??0)>1);
  const last=evs.at(-1);
  const latestAck=ack.at(-1);
  const latestCommit=commits.at(-1);
  const effectiveAck=latestAck&&latestCommit&&latestAck.at>=latestCommit.at;
  const awaitingAck=!!latestCommit&&!effectiveAck;
  const overdue=awaitingAck&&(asOf-latestCommit.at>=policy.ackDeadlineMs);
  const pendingAck=awaitingAck&&!overdue;
  const stale=!commits.length&&!ack.length&&!dead.length&&!reconciled.length &&
     (asOf-last.at>=policy.staleAfterMs);
  const startIndex=findings.length;
  if(uniqueEffects.length>1)
    add(group,'DUPLICATE_EFFECTS','HIGH',
      'Multiple distinct effect IDs were recorded for the same scoped operation; investigate possible duplicate business effects.',commits);
  if(commits.length>uniqueEffects.length)
    add(group,'REPEATED_COMMIT_RECORD','INFO',
      'One effect ID appears in multiple commit records; repeated telemetry does not establish a second effect.',commits);
  if(repeatedDeliveries.length)
    add(group,'REPEATED_DELIVERY','INFO',
      'A delivery identifier appears more than once. Redelivery alone does not establish duplicate processing.',received);
  if(received.length>policy.maxDeliveries)
    add(group,'DELIVERY_BUDGET_EXCEEDED','REVIEW',
      'More received records than the illustrative delivery budget. Compare with actual provider and retry policy.',received);
  if(latestCommit&&latestAck&&latestAck.at<latestCommit.at)
    add(group,'ACK_BEFORE_COMMIT','REVIEW',
      'Acknowledgement predates the latest effect commit and cannot prove that commit was acknowledged.',ack);
  if(!commits.length&&ack.length)
    add(group,'ACK_WITHOUT_COMMIT','REVIEW',
      'Acknowledged record has no effect_committed event in the supplied window; it may be a legitimate no-op.',ack);
  if(commits.length&&!received.length)
    add(group,'COMMIT_WITHOUT_RECEIPT','REVIEW',
      'Effect commit has no received record in the supplied trace window.',commits);
  if(overdue)
    add(group,'COMMIT_NOT_ACKNOWLEDGED','HIGH',
      'Last recorded effect commit is older than the configured acknowledgement deadline, without a recorded acknowledgement.',commits);
  if(stale)
    add(group,'STALE_UNRESOLVED','REVIEW',
      'No terminal evidence exists and the last recorded event is older than the configured stale threshold.',evs);
  if(dead.length&&!reconciled.length&&!commits.length)
    add(group,'DEAD_LETTERED','REVIEW',
      'The trace includes a dead-letter event but no later recovery evidence.',dead);
  if(latestCommit&&failed.some(e=>e.at>latestCommit.at))
    add(group,'FAILURE_AFTER_COMMIT','REVIEW',
      'A failure was recorded after the latest effect commit; the business effect may still exist.',failed);
  if(ack.length>1)
    add(group,'REPEATED_ACK','INFO','Multiple acknowledgement records observed; confirm they are only repeated telemetry.',ack);
  const groupFindings=findings.slice(startIndex);
  const status=uniqueEffects.length>1?'POTENTIAL_DUPLICATE_EFFECTS':
    overdue?'COMMIT_MISSING_ACK':stale?'STALE_UNRESOLVED':
    dead.length&&!commits.length&&!reconciled.length?'DEAD_LETTERED':
    effectiveAck?'ACK_RECORDED':
    ack.length&&!commits.length?'ACK_WITHOUT_COMMIT':
    pendingAck?'ACK_PENDING_WITHIN_WINDOW':
    commits.length?'COMMIT_RECORDED':
    reconciled.length?'RECONCILED_RECORDED':
    failed.length?'FAILURE_RECORDED':'IN_PROGRESS_OR_INCOMPLETE';
  operations.push({
   tenant:group.tenant,route:group.route,operationId:group.operationId,
   status,records:evs.length,received:received.length,distinctDeliveries:deliveryCounts.size,
   distinctEffects:uniqueEffects.length,acks:ack.length,commits:commits.length,
   latestEvent: last.timestamp,findings:groupFindings.map(f=>f.id)
  });
 }
 findings.sort((a,b)=>severityRank[a.severity]-severityRank[b.severity]||
   a.code.localeCompare(b.code)||String(a.operationId).localeCompare(String(b.operationId)));
 // Stable order-independent IDs follow sorted severity, not source insertion order.
 findings.forEach((f,i)=>{f.id='F-'+String(i+1).padStart(3,'0');});
 for(const op of operations){
  op.findings=findings.filter(f=>f.operationId===op.operationId&&f.scope?.tenant===op.tenant&&f.scope?.route===op.route).map(f=>f.id);
 }
 const totals={high:0,review:0,info:0};
 for(const f of findings)totals[f.severity.toLowerCase()]++;
 return {
  schema:'esheen-integration-delivery-trace-v1',
  state:'SUPPLIED_RECORDS_ONLY',
  evaluation:{asOf:asOfIso,policy},
  summary:{
   events:events.length,operations:operations.length,
   high:totals.high,review:totals.review,info:totals.info,
   potentialDuplicateEffects:findings.filter(x=>x.code==='DUPLICATE_EFFECTS').length,
   overdueAcknowledgements:findings.filter(x=>x.code==='COMMIT_NOT_ACKNOWLEDGED').length,
   staleOperations:findings.filter(x=>x.code==='STALE_UNRESOLVED').length
  },
  operations,findings,
  limitations:'Offline analysis of supplied synthetic or sanitized structural records only. Missing events, telemetry loss, malicious or inaccurate records and provider semantics may change every conclusion. A distinct effectId is evidence of multiple recorded IDs, not independent proof of duplicate real-world operations. No ingestion, live monitoring, authentication, side effects, external reconciliation, identity verification or compliance certification.'
 };
}
export function toMarkdown(result){
 if(result?.schema!=='esheen-integration-delivery-trace-v1')throw Error('Expected a delivery trace report.');
 const s=result.summary;
 const lines=[
 '# Integration delivery trace inspection — supplied records only','',
 'Evaluation as of: '+result.evaluation.asOf,
 'Events: '+s.events+' | Operations: '+s.operations+' | High: '+s.high+' | Review: '+s.review+' | Notes: '+s.info,
 '','## Operations'
 ];
 if(!result.operations.length)lines.push('No operations in supplied trace.');
 for(const x of result.operations)lines.push('- '+x.tenant+'/'+x.route+'/'+x.operationId+': '+x.status+
   ' ('+x.records+' records, '+x.distinctEffects+' recorded effect IDs, '+x.acks+' acks)');
 lines.push('','## Findings');
 if(!result.findings.length)lines.push('No flags within the supported patterns. This does not establish completeness or correctness.');
 for(const f of result.findings){
  lines.push('### '+f.severity+' — '+f.code+' ('+(f.operationId??'input')+')',
   f.explanation,'Action: '+f.action,'');
 }
 lines.push('','## Limits',result.limitations,'','Generated offline by Esheen Labs. No live integration tested.');
 return lines.join('\n')+'\n';
}
