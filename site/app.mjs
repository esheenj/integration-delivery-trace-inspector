import sample from './sample.mjs';
import {inspectTrace,toMarkdown} from './inspect.mjs';
const $=id=>document.getElementById(id);
let result=null;
function node(tag,value,cls){
 const n=document.createElement(tag);
 if(cls)n.className=cls;
 n.textContent=value;return n;
}
function reset(){
 $('source').value=JSON.stringify(sample,null,2);
 invalidate();
}
function invalidate(){
 result=null;$('results').hidden=true;$('inputError').hidden=true;$('inputError').textContent='';
}
function inspect(){
 try{
  const raw=$('source').value;
  if(!raw.trim()||raw.length>1048576)throw Error('Provide a JSON trace of no more than 1 MiB.');
  const report=inspectTrace(raw);
  result=report;$('inputError').hidden=true;
  const s=report.summary;
  for(const [key,value] of Object.entries({events:s.events,operations:s.operations,high:s.high,reviews:s.review,notes:s.info}))$(key).textContent=String(value);
  $('results').hidden=false;
  $('status').textContent=s.high?'HIGH-PRIORITY FLAGS':s.review?'REVIEW REQUIRED':'NO FLAGS IN SUPPLIED RECORDS';
  $('status').className='status '+(s.high?'high':s.review?'review':'clear');
  $('resultNote').textContent=report.limitations;
  $('scopeLabel').textContent='AS OF '+report.evaluation.asOf;
  const rows=$('operationRows');rows.replaceChildren();
  if(!report.operations.length){
   const tr=document.createElement('tr'),td=node('td','No operations supplied. No correctness can be inferred.');
   td.colSpan=5;tr.append(td);rows.append(tr);
  }
  for(const op of report.operations){
   const tr=document.createElement('tr'),name=document.createElement('td');
   name.append(node('strong',op.operationId),node('small',op.tenant+' / '+op.route));
   const state=document.createElement('td');
   state.append(node('span',op.status.replaceAll('_',' '),'state-tag '+(op.status==='POTENTIAL_DUPLICATE_EFFECTS'||op.status==='COMMIT_MISSING_ACK'?'high':op.status==='ACK_RECORDED'?'good':'attention')));
   tr.append(name,state,node('td',String(op.received)),node('td',String(op.distinctEffects)),node('td',String(op.acks)));
   rows.append(tr);
  }
  const findings=$('findings');findings.replaceChildren();
  if(!report.findings.length){
   const li=node('li','No supported-pattern flags in the supplied records. Completeness, accuracy and real outcomes remain unverified.','empty');
   findings.append(li);
  }
  for(const f of report.findings){
   const li=document.createElement('li');li.className='finding';
   const head=document.createElement('div');head.className='finding-head';
   head.append(node('span',f.severity,'priority '+f.severity),node('code',f.code+' / '+(f.operationId||'input')));
   li.append(head,node('p',f.explanation),node('strong','NEXT: '+f.action));
   li.append(node('small','Evidence IDs: '+(f.eventIds.length?f.eventIds.join(', '):'trace ordering')));
   findings.append(li);
  }
  $('results').scrollIntoView({behavior:'auto',block:'start'});
 }catch(error){
  invalidate();
  $('inputError').textContent=error.message;$('inputError').hidden=false;
 }
}
function save(text,filename,type){
 const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('restore').addEventListener('click',reset);
$('source').addEventListener('input',invalidate);
$('inspect').addEventListener('click',inspect);
$('exportMarkdown').addEventListener('click',()=>{if(result)save(toMarkdown(result),'integration-delivery-trace-report.md','text/markdown;charset=utf-8');});
$('exportJson').addEventListener('click',()=>{if(result)save(JSON.stringify(result,null,2),'integration-delivery-trace-report.json','application/json');});
reset();
