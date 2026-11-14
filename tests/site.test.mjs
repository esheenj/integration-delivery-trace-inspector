import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectTrace} from '../src/inspect.mjs';

const html=readFileSync('site/index.html','utf8');
const js=readFileSync('site/app.mjs','utf8');
const css=readFileSync('site/style.css','utf8');
const fixture=JSON.parse(readFileSync('examples/fictional-delivery-trace.json','utf8'));
test('fictional sample has the expected 22 events and 7 operations',()=>{
 const r=inspectTrace(fixture);
 assert.equal(r.summary.events,22);assert.equal(r.summary.operations,7);
});
test('fictional sample distinguishes 2 high, 3 review and 2 info flags',()=>{
 const s=inspectTrace(fixture).summary;
 assert.deepEqual([s.high,s.review,s.info],[2,3,2]);
});
test('sample includes potential double effects and overdue ack separately',()=>{
 const s=inspectTrace(fixture).summary;
 assert.equal(s.potentialDuplicateEffects,1);assert.equal(s.overdueAcknowledgements,1);assert.equal(s.staleOperations,1);
});
test('sample has all seven distinct lifecycle cases',()=>{
 assert.deepEqual(new Set(fixture.events.map(e=>e.operationId)).size,7);
});
test('site requires browser-local CSP',()=>{
 assert.match(html,/connect-src 'none'/);
 assert.match(html,/default-src 'none'/);
});
test('site contains exactly one main H1 and a keyboard skip link',()=>{
 assert.equal((html.match(/<h1\b/g)||[]).length,1);
 assert.match(html,/class="skip" href="#workbench"/);
});
test('browser imports validated module and embedded canonical sample',()=>{
 assert.match(js,/from '\.\/sample\.mjs'/);
 assert.match(js,/from '\.\/inspect\.mjs'/);
});
test('site never includes network-dependent scripts or images',()=>{
 assert.doesNotMatch(html,/<script[^>]*src="https?:\/\//i);
 assert.doesNotMatch(html,/<img[^>]*src="https?:\/\//i);
});
test('site has core controls for evidence and exports',()=>{
 for(const id of ['source','restore','inspect','results','events','operations','high','reviews','notes','operationRows','findings','exportMarkdown','exportJson','inputError']){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
});
test('browser logic does not fetch, track or persist inputs',()=>{
 assert.doesNotMatch(js,/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\blocalStorage\b|\bsessionStorage\b/);
});
test('business contact is user-initiated and nonbinding',()=>{
 assert.match(html,/mailto:info@sigmacode\.co\.za\?subject=/);
 assert.match(html,/enquiry is not a purchase or confirmed service/);
});
test('disclaimer is accessible near the output',()=>assert.match(html,/FLAGS ≠ CERTIFIED INCIDENTS/));
test('mobile and reduced-motion styling exists',()=>{
 assert.match(css,/@media\(max-width:710px\)/);
 assert.match(css,/@media\(max-width:420px\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
test('HTML has canonical target and social metadata',()=>{
 assert.match(html,/rel="canonical" href="https:\/\/esheenj\.github\.io\/integration-delivery-trace-inspector\/"/);
 assert.match(html,/property="og:title"/);
});
