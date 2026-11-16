// Small release canary. Caller supplies the Groq key in the environment; no vault is read.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const LIMIT = 8000;
const MODEL = 'openai/gpt-oss-120b';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: GROQ_API_KEY=... node scripts/groq-canary.mjs --release <full-HEAD-SHA>\n  node scripts/groq-canary.mjs --inspect-budget <fixture.json>\nUses primary GPT-OSS 120B only. Estimates reserve from its tokenizer with framing margin; provider-reported uncached input and output settle actual usage. Ledger and crash lock persist in /tmp per release; unknown usage permanently retains its reservation. --inspect-budget uses only a private fixture, with no tokenizer or network access.');
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
function reserveBudget(ledger, path, model, tokenCount, maxOutput) {
  assert.ok(!ledger.requests.some(r => r.status !== 'settled'), 'Unsettled usage or reservation blocks further calls');
  assert.ok(Number.isSafeInteger(tokenCount) && tokenCount > 0 && Number.isSafeInteger(maxOutput) && maxOutput > 0 && maxOutput <= 512, 'Invalid token reservation');
  // The exact tokenizer is applied to serialized outbound JSON. Provider framing
  // differs, so the margin is an estimate, not provider-reported actual usage.
  const inputReserve = Math.max(2 * tokenCount, tokenCount + 1500);
  const reserved = inputReserve + maxOutput;
  assert.ok(reserved <= LIMIT - ledger.charged, `Budget exhausted: need ${reserved}, remaining ${Math.max(0, LIMIT-ledger.charged)}`);
  const row = {model, tokenCount, inputReserve, maxOutput, reserved, at:new Date().toISOString(), status:'reserved'};
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
assert.ok(args.length === 2 && args[0] === '--release' && /^[a-f0-9]{40}$/.test(args[1]), 'Provide --release followed by a full lowercase Git SHA');
const key = process.env.GROQ_API_KEY;
assert.ok(key, 'GROQ_API_KEY must be present in caller environment');
const release = args[1];
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(), release, 'Release must be the current checkout HEAD');
assert.ok(!process.env.GROQ_MODEL || process.env.GROQ_MODEL === MODEL, `Canary supports ${MODEL} only`);
const ledgerPath = join(tmpdir(), `aurelle-groq-canary-${release}.json`);
const lockPath = join(tmpdir(), `aurelle-groq-canary-${release}.lock`);
// Crash leaves lock and reservation for manual investigation; no silent reset.
mkdirSync(lockPath, {mode:0o700});
let ledger;
try { ledger=loadBudget(ledgerPath, release); } catch(e) { rmdirSync(lockPath); throw e; }
let child, proxy;
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { child?.kill('SIGTERM'); proxy?.close(); process.exit(signal === 'SIGINT' ? 130 : 143); });
const sleep = ms => new Promise(r=>setTimeout(r,ms));
let busy = false;
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
      row=reserveBudget(ledger,ledgerPath,body.model,tokenCount,maxOutput);
      console.log(`[BUDGET] estimated input ${tokenCount}, reserved ${row.reserved}; remaining ${LIMIT-ledger.charged}; route ${body.model}`);
      const response=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${key}`},body:outbound,redirect:'error',signal:AbortSignal.timeout(60000)});
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
  Object.assign(env,{NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),CHAT_PROVIDER:'groq',GROQ_BASE_URL:`http://127.0.0.1:${proxy.address().port}/openai/v1`,GROQ_API_KEY:'canary-proxy',GROQ_MODEL:MODEL,GROQ_FALLBACK_MODEL:'',GROQ_FALLBACK_API_KEY:'',GROQ_BALANCER:'false',GROQ_TRANSPORT:'node'});
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
  await turn('Hello, how can you help me?');
  assert.ok(ledger.requests.length===before+1 && ledger.requests[before].status==='settled', 'Free message must produce exactly one measured provider call');
  const comparison=await turn('Compare mugs and carafe',{type:'compare',productIds:['mugs','carafe']});
  assert.equal(comparison.comparison?.productIds.length,2);
  assert.equal(ledger.requests.length,before+1,'Deterministic comparison unexpectedly invoked the provider');
  const advised=await turn('Explain differences',{type:'advice',operationId:comparison.op.id});
  assert.equal(advised.advice?.status,'included','Explicit advice was unavailable');
  assert.ok(ledger.requests.length===before+2 && ledger.requests[before+1].status==='settled', 'Advice must produce exactly one measured provider call');
  assert.ok(ledger.charged<=LIMIT, 'Release budget exceeded');
  console.log(`[PASS] Groq canary route ${MODEL}; release ${release}; ${ledger.charged}/${LIMIT} uncached input + output charged; ledger ${ledgerPath}.`);
} catch(e) {console.error(`[FAIL] ${e.message}; ${ledger.charged}/${LIMIT} charged; ledger ${ledgerPath}`); process.exitCode=1;}
finally {child?.kill('SIGTERM'); proxy?.close(); if(child && child.exitCode===null) await Promise.race([new Promise(r=>child.once('exit',r)),sleep(3000).then(()=>child.kill('SIGKILL'))]); rmdirSync(lockPath);}
