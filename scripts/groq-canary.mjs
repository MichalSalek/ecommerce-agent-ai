// Small release canary. Caller supplies the Groq key in the environment; no vault is read.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { GROQ_IDENTITY } from '../src/infrastructure/chat/groq-identity.mjs';

const LIMIT = 8000;
const MODEL = GROQ_IDENTITY.modelId;
// A caller-selected TMPDIR must not silently create a fresh release budget.
const releaseDir = '/tmp';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: GROQ_API_KEY=... node scripts/groq-canary.mjs --release <full-HEAD-SHA> [--continue-release <root-SHA> --advice-only]\n  node scripts/groq-canary.mjs --release <HEAD-SHA> --continue-release <root-SHA> --reserve-public --amount <max-tokens>\n  node scripts/groq-canary.mjs --release <HEAD-SHA> --continue-release <root-SHA> --settle-public --reservation <id> --input <n> --cached <n> --output <n>\n  node scripts/groq-canary.mjs --inspect-budget <fixture.json>\nContinuation uses the root ledger, preserving earlier spend and explicitly reusing prior free-message evidence. Public calls are outside the proxy and require a separate prior reservation and measured settlement; use --unknown-usage instead of counts to retain an unresolved reservation. Uses primary GPT-OSS 120B only. Tokenized input plus margin is an estimate; actual reported uncached input and output settle usage.');
  process.exit(0);
}

function persist(path, value) {
  // Persist before sending. An interrupted write makes the ledger unreadable, hence fail closed.
  const fd = openSync(path, 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
}
function loadBudget(path, release) {
  if (!existsSync(path)) {
    const fd = openSync(path, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify({release, limit:LIMIT, charged:0, requests:[]})); fsyncSync(fd); } finally { closeSync(fd); }
  }
  const value = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(value.release, release); assert.equal(value.limit, LIMIT);
  assert.ok(Number.isSafeInteger(value.charged) && value.charged >= 0 && Array.isArray(value.requests), 'Invalid budget ledger');
  return value;
}
function reserveBudget(ledger, path, model, tokenCount, maxOutput, metadata = {}) {
  assert.ok(!ledger.requests.some(r => r.status !== 'settled'), 'Unsettled usage or reservation blocks further calls');
  assert.ok(Number.isSafeInteger(tokenCount) && tokenCount > 0 && Number.isSafeInteger(maxOutput) && maxOutput > 0 && maxOutput <= 512, 'Invalid token reservation');
  // The exact tokenizer is applied to serialized outbound JSON. Provider framing
  // differs, so the margin is an estimate, not provider-reported actual usage.
  const inputReserve = Math.max(2 * tokenCount, tokenCount + 1500);
  const reserved = inputReserve + maxOutput;
  assert.ok(reserved <= LIMIT - ledger.charged, `Budget exhausted: need ${reserved}, remaining ${Math.max(0, LIMIT-ledger.charged)}`);
  const row = {model, tokenCount, inputReserve, maxOutput, reserved, at:new Date().toISOString(), status:'reserved', ...metadata};
  ledger.charged += reserved; ledger.requests.push(row); persist(path, ledger);
  return row;
}
function settleBudget(ledger, path, row, usage) {
  assert.equal(row.status, 'reserved', 'Reservation is already finalized');
  if (!usage) { row.status='usage-unavailable-reservation-retained'; persist(path, ledger); return; }
  const {input, output, cached} = usage;
  assert.ok([input, output, cached].every(Number.isSafeInteger) && input >= 0 && output >= 0 && cached >= 0 && cached <= input, 'Invalid provider usage');
  const uncached = input - cached + output;
  row.usage = {input, output, cached, uncached};
  ledger.charged += uncached - row.reserved;
  row.status = uncached > row.reserved ? 'under-reserved' : 'settled';
  persist(path, ledger);
  assert.equal(row.status, 'settled', 'Actual usage exceeded estimate; budget is frozen');
}
function usageFrom(value) {
  const u = value?.usage ?? value?.x_groq?.usage;
  if (!u) return;
  const input = u.prompt_tokens, output = u.completion_tokens, cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  if ([input,output,cached].every(Number.isSafeInteger) && input>=0 && output>=0 && cached>=0 && cached<=input) return {input,output,cached};
}

// Exercise the real ledger logic without key, network, app, or tokenizer download.
// Fixture: {"ledgerPath":"/tmp/...", "operations":[{"type":"reserve","tokens":100,"maxOutput":256},{"type":"settle","usage":{"input":80,"output":20,"cached":10}}]}.
if (args[0] === '--inspect-budget') {
  assert.equal(args.length, 2, 'Expected --inspect-budget <fixture.json>');
  const fixture = JSON.parse(readFileSync(args[1], 'utf8'));
  const path = resolve(fixture.ledgerPath);
  assert.ok(path.startsWith(resolve(tmpdir()) + '/') && !/aurelle-groq-canary-/.test(path), 'Fixture ledger must be a separate /tmp file');
  const ledger = loadBudget(path, 'fixture');
  let current;
  for (const op of fixture.operations) {
    if (op.type === 'reserve') current = reserveBudget(ledger, path, MODEL, op.tokens, op.maxOutput);
    else if (op.type === 'settle') { assert.ok(current, 'No current reservation'); settleBudget(ledger, path, current, op.usage); }
    else throw new Error('Unknown fixture operation');
  }
  console.log(JSON.stringify(ledger));
  process.exit(0);
}
const {values} = parseArgs({args, options:{release:{type:'string'}, 'continue-release':{type:'string'}, 'advice-only':{type:'boolean'}, 'reserve-public':{type:'boolean'}, 'settle-public':{type:'boolean'}, reservation:{type:'string'}, amount:{type:'string'}, input:{type:'string'}, cached:{type:'string'}, output:{type:'string'}, 'unknown-usage':{type:'boolean'}}});
assert.ok(/^[a-f0-9]{40}$/.test(values.release ?? ''), 'Provide --release followed by a full lowercase Git SHA');
const release = values.release;
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(), release, 'Release must be the current checkout HEAD');
const rootRelease = values['continue-release'] ?? release;
const publicAction = values['reserve-public'] || values['settle-public'];
const key = process.env.GROQ_API_KEY;
if (!publicAction) assert.ok(key, 'GROQ_API_KEY must be present in caller environment');
assert.ok(/^[a-f0-9]{40}$/.test(rootRelease), 'Invalid root release SHA');
const isAncestor = (ancestor, descendant) => { try { execFileSync('git',['merge-base','--is-ancestor',ancestor,descendant],{cwd:root,stdio:'ignore'}); return true; } catch { return false; } };
assert.ok(isAncestor(rootRelease, release), 'Root release must be an ancestor of current HEAD');
const ancestors = readdirSync(releaseDir).map(name=>name.match(/^aurelle-groq-canary-([a-f0-9]{40})\.json$/)?.[1]).filter(Boolean).filter(sha=>isAncestor(sha,release));
if (!values['continue-release']) assert.ok(ancestors.every(sha=>sha===release),'Existing ancestor release ledger found; use --continue-release to preserve its budget');
else assert.ok(ancestors.every(sha=>sha===rootRelease), 'Multiple ancestor ledgers exist; reconcile their spending before continuing');
assert.ok(!(values['reserve-public'] && values['settle-public']), 'Choose one public ledger action');
// The first acceptance can be a real browser turn. Starting the ledger here
// avoids spending tokens on an unrelated canary just to initialize accounting.
assert.ok(!publicAction || !values['advice-only'], 'Public accounting cannot run advice-only mode');
assert.ok(publicAction || Boolean(values['continue-release']) === Boolean(values['advice-only']), 'Continuation requires both --continue-release and --advice-only');
assert.ok(!process.env.GROQ_MODEL || process.env.GROQ_MODEL === MODEL, `Canary supports ${MODEL} only`);
const ledgerPath = join(releaseDir, `aurelle-groq-canary-${rootRelease}.json`);
const lockPath = join(releaseDir, `aurelle-groq-canary-${rootRelease}.lock`);
if (values['continue-release'] || values['settle-public']) assert.ok(existsSync(ledgerPath), 'Root release ledger is missing; refusing to create a new budget');
// Crash leaves lock and reservation for manual investigation; no silent reset.
mkdirSync(lockPath, {mode:0o700});
let ledger;
try { ledger=loadBudget(ledgerPath, rootRelease); } catch(e) { rmdirSync(lockPath); throw e; }
if (publicAction) {
  try {
    const integer = (value, name) => { assert.ok(/^\d+$/.test(value ?? ''), `Invalid ${name}`); const n=Number(value); assert.ok(Number.isSafeInteger(n), `Invalid ${name}`); return n; };
    if (values['reserve-public']) {
      assert.ok(!ledger.requests.some(r=>r.status!=='settled'), 'Unsettled usage or reservation blocks further calls');
      const reserved=integer(values.amount,'amount');
      assert.ok(reserved>0 && reserved<=LIMIT-ledger.charged, 'Public reservation exceeds remaining budget');
      const row={id:randomUUID(), sourceRevision:release, stage:'public', model:'public-runtime', reserved, at:new Date().toISOString(), status:'reserved'};
      ledger.charged+=reserved; ledger.requests.push(row); persist(ledgerPath,ledger);
      console.log(`[PUBLIC RESERVED] ${row.id}; ${reserved} reserved, ${LIMIT-ledger.charged} remains; root ${rootRelease}. Public requests bypass the proxy.`);
    } else {
      const row=ledger.requests.find(r=>r.id===values.reservation && r.stage==='public');
      assert.ok(row && row.sourceRevision===release && row.status==='reserved', 'Matching pending public reservation not found');
      const usage=values['unknown-usage'] ? undefined : {input:integer(values.input,'input'),cached:integer(values.cached,'cached'),output:integer(values.output,'output')};
      settleBudget(ledger,ledgerPath,row,usage);
      console.log(`[PUBLIC ${usage?'SETTLED':'UNRESOLVED'}] ${row.id}; total ${ledger.charged}/${LIMIT}, root ${rootRelease}.`);
    }
  } finally { rmdirSync(lockPath); }
  process.exit(0);
}
if (values['advice-only']) {
  const proof=ledger.freeTextPassed, row=ledger.requests[proof?.requestIndex];
  try {
    assert.ok(proof && /^[a-f0-9]{40}$/.test(proof.revision) && isAncestor(proof.revision,release), 'Missing or invalid previous free-message evidence');
    assert.ok(row?.status==='settled' && row.http===200 && row.model===MODEL && row.sourceRevision===proof.revision && row.stage==='free-message', 'Free-message evidence does not match settled provider usage');
    if (proof.log) assert.equal(createHash('sha256').update(readFileSync(proof.log.path)).digest('hex'),proof.log.sha256,'Previous free-message log changed');
    console.log(`[REUSE] Free message passed on ${proof.revision}, request ${proof.requestIndex}; current revision ${release}; root budget ${rootRelease}.`);
  } catch(e) { rmdirSync(lockPath); throw e; }
}
let child, proxy;
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { child?.kill('SIGTERM'); proxy?.close(); process.exit(signal === 'SIGINT' ? 130 : 143); });
const sleep = ms => new Promise(r=>setTimeout(r,ms));
let busy = false, stage = 'not-started';
try {
  assert.ok(!ledger.requests.some(r=>r.status!=='settled'), 'Existing unresolved reservation blocks canary');
  console.log(`[TOKENIZER] ${MODEL}; downloading tokenizer files to private /tmp cache if necessary`);
  const {AutoTokenizer} = await import('@huggingface/transformers');
  const tokenizerCache = join(tmpdir(),'aurelle-tokenizers');
  mkdirSync(tokenizerCache, {recursive:true,mode:0o700}); chmodSync(tokenizerCache, 0o700);
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL, {cache_dir:tokenizerCache});
  proxy = createServer(async (req,res) => {
    let row, acquired=false;
    try {
      assert.ok(!busy, 'Concurrent provider calls are disabled'); busy=true; acquired=true;
      assert.equal(req.method,'POST'); assert.equal(req.url,'/openai/v1/chat/completions');
      const chunks=[]; let size=0;
      for await (const c of req) { size+=c.length; assert.ok(size<=100000); chunks.push(c); }
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(body.model,MODEL, 'Only the GPT-OSS primary route is allowed');
      const requested=Number(body.max_tokens ?? body.max_completion_tokens ?? 512);
      assert.ok(Number.isSafeInteger(requested) && requested>0);
      // The app asks for 256 for advice and more for interpretation.
      const maxOutput=Math.min(requested, requested<=256 ? 256 : 512);
      body.max_tokens=maxOutput; body.n=1; delete body.max_completion_tokens;
      if (body.stream) body.stream_options={...(body.stream_options??{}),include_usage:true};
      const outbound=JSON.stringify(body);
      const tokenCount=tokenizer.encode(outbound,{add_special_tokens:false}).length;
      assert.ok(stage==='free-message' || stage==='advice', `Unexpected provider call during ${stage}`);
      row=reserveBudget(ledger,ledgerPath,body.model,tokenCount,maxOutput,{sourceRevision:release,stage});
      console.log(`[BUDGET] estimated input ${tokenCount}, reserved ${row.reserved}; remaining ${LIMIT-ledger.charged}; route ${body.model}`);
      const response=await fetch(`${GROQ_IDENTITY.baseURL}/chat/completions`,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${key}`},body:outbound,redirect:'error',signal:AbortSignal.timeout(60000)});
      // Read even if SDK times out; persist usage before delivering the response.
      const raw=await response.text();
      let usage;
      if ((response.headers.get('content-type')??'').includes('text/event-stream')) {
        for (const line of raw.split(/\r?\n/)) if (line.startsWith('data: ') && line!=='data: [DONE]') {try { usage=usageFrom(JSON.parse(line.slice(6))) ?? usage; } catch {}}
      } else { try { usage=usageFrom(JSON.parse(raw)); } catch {} }
      row.http=response.status;
      settleBudget(ledger,ledgerPath,row,usage);
      if (usage) console.log(`[USAGE] ${body.model}: ${usage.input} input, ${usage.cached} cached, ${usage.output} output; ${ledger.charged}/${LIMIT} charged`);
      else console.error(`[BUDGET] Provider usage missing; retained ${row.reserved} and blocked further calls`);
      const headers={}; for (const [name,value] of response.headers) if (/^(content-type|retry-after|x-ratelimit-.+|ratelimit-.+)$/i.test(name)) headers[name]=value;
      res.writeHead(response.status,headers); res.end(raw);
    } catch(e) {
      if (row?.status==='reserved') settleBudget(ledger,ledgerPath,row,undefined);
      console.error(`[PROXY] ${e.message}`);
      if (!res.headersSent) res.writeHead(429,{'content-type':'application/json'});
      res.end(JSON.stringify({error:{message:'Canary budget or transport unavailable',type:'rate_limit_error'}}));
    } finally { if (acquired) busy=false; }
  });
  await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
  const port=await new Promise((r,reject)=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):r(p));});});
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/groq|proxy|openai|anthropic|llama/i.test(k)));
  Object.assign(env,{NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),AURELLE_LOCAL_QA:'groq-proxy',GROQ_BASE_URL:`http://127.0.0.1:${proxy.address().port}/openai/v1`,GROQ_API_KEY:'canary-proxy'});
  child=spawn(process.execPath,[join(root,'.next/standalone/server.js')],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>process.stdout.write(b)); child.stderr.on('data',b=>process.stderr.write(b));
  const base=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error(`App exited ${child.exitCode}`); try {if((await fetch(`${base}/api/health`,{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}} catch{} await sleep(500);}
  assert.ok(ready,'Standalone app did not start');
  const id=randomUUID(),messages=[];
  async function turn(text,action) {
    messages.push({id:randomUUID(),role:'user',parts:[{type:'text',text}],...(action?{metadata:{shoppingAction:action}}:{})});
    const response=await fetch(`${base}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contract:'shopping-v3',conversationId:id,messages,cart:{lines:[]}}),signal:AbortSignal.timeout(40000)});
    assert.equal(response.status,200,`App HTTP ${response.status}`);
    const raw=await response.text(); const events=raw.split(/\r?\n/).filter(s=>s.startsWith('data: ')&&s!=='data: [DONE]').map(s=>JSON.parse(s.slice(6)));
    const get=type=>events.find(e=>e.type===`data-${type}`)?.data;
    const op=get('operation'),advice=get('advice'); assert.equal(op?.status,'completed');
    const answer=events.filter(e=>e.type==='text-delta').map(e=>e.delta).join(''); assert.ok(answer.trim());
    messages.push({id:events.find(e=>e.type==='start')?.messageId??randomUUID(),role:'assistant',parts:[{type:'text',text:answer},...events.filter(e=>['data-shoppingState','data-products','data-categories','data-comparison','data-turnStatus','data-operation','data-advice'].includes(e.type)).map(({type,data,id})=>({type,data,...(id?{id}:{})}))]});
    return {op,advice,comparison:get('comparison')};
  }
  const before=ledger.requests.length;
  if (!values['advice-only']) {
    stage='free-message';
    await turn('Hello, how can you help me?');
    assert.ok(ledger.requests.length===before+1 && ledger.requests[before].status==='settled' && ledger.requests[before].http===200, 'Free message must produce exactly one measured provider call');
    ledger.freeTextPassed={revision:release,requestIndex:before,recordedAt:new Date().toISOString(),evidence:'runner-validated'};
    persist(ledgerPath,ledger);
  }
  const afterFree=ledger.requests.length;
  stage='deterministic-comparison';
  const comparison=await turn('Compare mugs and carafe',{type:'compare',productIds:['mugs','carafe']});
  assert.equal(comparison.comparison?.productIds.length,2);
  assert.equal(ledger.requests.length,afterFree,'Deterministic comparison unexpectedly invoked the provider');
  stage='advice';
  const advised=await turn('Explain differences',{type:'advice',operationId:comparison.op.id});
  assert.equal(advised.advice?.status,'included','Explicit advice was unavailable');
  assert.ok(ledger.requests.length===afterFree+1 && ledger.requests[afterFree].status==='settled', 'Advice must produce exactly one measured provider call');
  assert.ok(ledger.charged<=LIMIT, 'Release budget exceeded');
  console.log(`[PASS] Groq canary route ${MODEL}; advice revision ${release}; free message ${values['advice-only']?`reused from ${ledger.freeTextPassed.revision}`:`fresh on ${release}`}; root ${rootRelease}; ${ledger.charged}/${LIMIT} uncached input + output charged; ledger ${ledgerPath}.`);
} catch(e) {console.error(`[FAIL] ${e.message}; ${ledger.charged}/${LIMIT} charged; ledger ${ledgerPath}`); process.exitCode=1;}
finally {child?.kill('SIGTERM'); proxy?.close(); if(child && child.exitCode===null) await Promise.race([new Promise(r=>child.once('exit',r)),sleep(3000).then(()=>child.kill('SIGKILL'))]); rmdirSync(lockPath);}
