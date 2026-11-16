// Private local acceptance. Start a built standalone app under an isolated llama-only environment.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/agent-local.mjs [--engine] [--smoke|--suite] [--resume /tmp/artifact.json] [--query-guard-revision <old-SHA>] [--artifact /tmp/artifact.json] [--inspect-resume]\n--engine: source-based ENGINE functional QA with 600s test turns; not HTTP latency acceptance. Cross-revision reuse requires the explicit query-guard revision and a verified guard-only source change; --inspect-resume verifies without running the model. Without --engine requires an up-to-date standalone build. Both require local llama-server. Private artifacts reuse only whole passing batches of the same mode and inputs.');
  process.exit(0);
}
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  assert.ok(['--engine', '--smoke', '--suite', '--resume', '--artifact', '--query-guard-revision', '--inspect-resume'].includes(args[i]), `Unknown option: ${args[i]}`);
  if (['--resume', '--artifact', '--query-guard-revision'].includes(args[i])) assert.ok(args[++i] && !args[i].startsWith('--'), 'Missing option value');
}
assert.ok(!(args.includes('--smoke') && args.includes('--suite')), 'Choose smoke or suite');
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const mode = args.includes('--smoke') ? 'smoke' : 'suite';
const engine = args.includes('--engine');
const execution = engine ? 'engine-functional-QA' : 'standalone-http';
const privatePath = (value) => {
  const path = resolve(value);
  assert.ok(path.startsWith(resolve(tmpdir()) + '/'), 'Artifact must be inside the private temporary directory');
  return path;
};
const artifact = privatePath(option('--artifact') ?? join(tmpdir(), `aurelle-local-${Date.now()}.json`));
const resume = option('--resume') && privatePath(option('--resume'));
const guardRevision = option('--query-guard-revision');
assert.ok(!guardRevision || (engine && resume && /^[a-f0-9]{40}$/.test(guardRevision)), '--query-guard-revision requires --engine, --resume and a full lowercase Git SHA');
assert.ok(!args.includes('--inspect-resume') || (guardRevision && resume), '--inspect-resume requires --query-guard-revision and --resume');
assert.notEqual(artifact, resume, 'Resume and output must differ');
const root = fileURLToPath(new URL('../', import.meta.url));
const upstream = new URL(process.env.LLAMA_BASE_URL ?? 'http://172.20.0.1:8090/v1');
const host = upstream.hostname;
assert.ok(upstream.protocol === 'http:' && !upstream.username && !upstream.password && !upstream.search && !upstream.hash && (/^127\.(\d{1,3}\.){2}\d{1,3}$/.test(host) || host === 'localhost' || /^10\.(\d{1,3}\.){2}\d{1,3}$/.test(host) || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) || /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)), 'llama endpoint must be a private IPv4 or localhost HTTP endpoint');
const model = 'qwen38-uncensored';
async function files(dir) {
  const paths = [];
  for (const e of (await readdir(join(root, dir), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory()) paths.push(...await files(path)); else if (e.isFile()) paths.push(path);
  }
  return paths;
}
async function hash(paths) {
  const h = createHash('sha256');
  for (const path of paths) { const content = await readFile(join(root, path)); h.update(`${path.length}:${path}:${content.length}:`); h.update(content); }
  return h.digest('hex');
}
const sourcePaths = await files('src');
const fingerprint = await hash([...sourcePaths, 'package-lock.json', ...(!engine ? ['.next/standalone/server.js', '.next/standalone/.next/BUILD_ID', ...(await files('.next/standalone/.next/server'))] : [])]);
const runnerHash = await hash(['scripts/agent-local.mjs', 'scripts/agent-local-core.ts']);
const old = resume && JSON.parse(await readFile(resume, 'utf8'));
let resumeCompatibility;
if (old) {
  assert.equal(old.model, model, 'Model changed');
  assert.equal(old.upstream, upstream.href, 'Local endpoint changed');
  assert.equal(old.execution, execution, 'Cannot reuse evidence from another execution mode');
  assert.ok(Array.isArray(old.batches), 'Invalid resume batches');
  if (!guardRevision) {
    assert.equal(old.fingerprint, fingerprint, 'Source/build fingerprint changed');
    assert.equal(old.runnerHash, runnerHash, 'Runner changed');
  } else {
    const guardPath='src/application/chat/query-language.ts';
    const git=(...gitArgs)=>execFileSync('git',gitArgs,{cwd:root,maxBuffer:16*1024*1024});
    git('cat-file','-e',`${guardRevision}^{commit}`);
    const tracked=git('ls-tree','-r','--name-only','-z',guardRevision,'--','src').toString().split('\0').filter(Boolean);
    assert.deepEqual([...tracked].sort(),[...sourcePaths].sort(),'Source paths differ from original revision');
    const revisionContent=path=>git('show',`${guardRevision}:${path}`);
    const framedHash=paths=>{const h=createHash('sha256'); for(const path of paths){const content=revisionContent(path);h.update(`${path.length}:${path}:${content.length}:`);h.update(content);} return h.digest('hex');};
    assert.equal(framedHash([...sourcePaths,'package-lock.json']),old.fingerprint,'Original revision does not match artifact source fingerprint');
    assert.equal(framedHash(['scripts/agent-local.mjs','scripts/agent-local-core.ts']),old.runnerHash,'Original revision does not match artifact runner fingerprint');
    assert.ok((await readFile(join(root,'scripts/agent-local-core.ts'))).equals(revisionContent('scripts/agent-local-core.ts')),'Engine helper changed from original revision');
    const changed=[];
    for(const path of [...sourcePaths,'package-lock.json']) if(!(await readFile(join(root,path))).equals(revisionContent(path))) changed.push(path);
    assert.deepEqual(changed,[guardPath],'Only the query-language guard may differ from the original revision');
    const passed=old.batches.filter(batch=>batch.passed===true);
    assert.ok(passed.length>0,'No successful batches to reuse');
    const queries=new Set(); let sawUndefined=false;
    for(const batch of passed) {
      assert.ok(Array.isArray(batch.turns) && batch.turns.length>0 && batch.turns.every(turn=>turn.validated===true && turn.checkpoint?.after?.criteria),`Incomplete successful batch ${batch.name}`);
      for(const turn of batch.turns) for(const query of [turn.checkpoint.after.criteria.query,turn.result?.appliedCriteria?.query,turn.products?.appliedCriteria?.query]) {
        if(query===undefined) sawUndefined=true; else {assert.equal(typeof query,'string','Recorded query must be a string');queries.add(query);}
      }
    }
    const checkedQueries=[...queries].sort();
    const probe=`import {queryLanguageError} from './src/application/chat/query-language'; (async()=>{let input=''; for await (const chunk of process.stdin) input+=chunk; const data=JSON.parse(input); for(const value of data.queries) if(queryLanguageError(value)!==undefined) throw new Error('A previously passing query is now rejected'); if(data.checkUndefined && queryLanguageError(undefined)!==undefined) throw new Error('Undefined query is now rejected');})()`;
    try {execFileSync(join(root,'node_modules/.bin/tsx'),['-e',probe],{cwd:root,input:JSON.stringify({queries:checkedQueries,checkUndefined:sawUndefined}),stdio:['pipe','pipe','pipe']});}
    catch {throw new Error('A previously passing query was rejected or the guard could not be evaluated');}
    assert.equal(await hash([...sourcePaths,'package-lock.json']),fingerprint,'Source changed during resume verification');
    resumeCompatibility={kind:'query-guard-only',originalRevision:guardRevision,originalFingerprint:old.fingerprint,currentFingerprint:fingerprint,originalRunnerHash:old.runnerHash,currentRunnerHash:runnerHash,changedPath:guardPath,checkedQueries,checkedUndefined:sawUndefined,sourceArtifact:resume,reusedBatches:passed.map(batch=>batch.name)};
  }
}
if (args.includes('--inspect-resume')) {console.log(JSON.stringify(resumeCompatibility)); process.exit(0);}
const report = { fingerprint, runnerHash, mode, execution, model, upstream: upstream.href, ...(resumeCompatibility?{resumeCompatibility}:{}), note: engine ? 'ENGINE functional QA only, not production HTTP latency acceptance. Local Qwen is not equivalent to Groq; cart writes are simulated.' : 'Standalone HTTP QA; local Qwen is not equivalent to Groq; cart writes are simulated.', batches: [], failures: [], started: new Date().toISOString() };
async function save() { const p = `${artifact}.${process.pid}.tmp`; await writeFile(p, JSON.stringify(report, null, 2), { mode: 0o600 }); await rename(p, artifact); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let modelCalls = 0, modelSuccesses = 0;
const upstreamCalls = new Set();
let warming = true, warmClaimed = false, finishWarm;
const warmResult = new Promise(resolve => { finishWarm = resolve; });
const proxy = createServer(async (req, res) => {
  const controller = new AbortController();
  upstreamCalls.add(controller);
  let warmRequest = false;
  const disconnect = () => { if (!res.writableEnded && !warmRequest) controller.abort(); };
  res.on('close', disconnect);
  try {
    const path = req.url;
    assert.ok(path === '/v1/models' || path === '/v1/chat/completions', 'Unexpected model path');
    const chunks = []; for await (const c of req) chunks.push(c);
    let body = Buffer.concat(chunks).toString();
    if (path.endsWith('/chat/completions')) {
      const v = JSON.parse(body); assert.equal(v.model, model); v.chat_template_kwargs = {...v.chat_template_kwargs, enable_thinking:false};
      if (warming && engine) v.max_tokens=1; // Prefill only; deliberately not a functional response.
      body = JSON.stringify(v); modelCalls++;
      if (warming && !engine) { assert.ok(!warmClaimed, 'Warm probe permits one native request'); warmClaimed = true; warmRequest = true; }
    }
    const response = await fetch(`${upstream.href.replace(/\/$/, '')}${path.slice(3)}`, { method:req.method, headers: { 'content-type':'application/json' }, ...(req.method === 'POST' ? {body} : {}), redirect:'error', signal:AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]) });
    if (!res.destroyed) res.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'application/json' });
    if (response.body) for await (const chunk of response.body) if (!res.destroyed) res.write(chunk);
    if (!res.destroyed) res.end();
    if (path.endsWith('/chat/completions') && response.ok) modelSuccesses++;
    if (warmRequest) finishWarm({ok:response.ok, status:response.status});
  } catch (e) {
    if (!res.destroyed) { if (!res.headersSent) res.writeHead(502); res.end(); }
    if (warmRequest) finishWarm({ok:false, error:e.message});
    if (!controller.signal.aborted) console.error('[LOCAL PROXY]', e.message);
  } finally { res.off('close', disconnect); upstreamCalls.delete(controller); }
});
await new Promise(r => proxy.listen(0, '127.0.0.1', r));
let child;
const shutdown = () => { for (const call of upstreamCalls) call.abort(); child?.kill('SIGTERM'); proxy.close(); };
process.once('SIGINT', () => { shutdown(); process.exit(130); });
process.once('SIGTERM', () => { shutdown(); process.exit(143); });
try {
  const modelBase = `http://127.0.0.1:${proxy.address().port}/v1`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/groq|proxy|openai|anthropic/i.test(k)));
  Object.assign(env, { NODE_ENV:'production', HOSTNAME:'127.0.0.1', CHAT_PROVIDER:'llama', LLAMA_BASE_URL:modelBase, LLAMA_MODEL:model, CHAT_REQUESTS_PER_HOUR:'1000', ...(engine ? {EMBEDDING_MODEL:'minilm'} : {GROQ_API_KEY:'', GROQ_FALLBACK_API_KEY:'', GROQ_BASE_URL:'http://127.0.0.1:1/v1', GROQ_BALANCER:'false', GROQ_TRANSPORT:'node'}) });
  let appPort;
  if (engine) {
    child = spawn(process.execPath, ['--import','tsx',join(root,'scripts/agent-local-core.ts')], {cwd:root, env, stdio:['ignore','pipe','pipe','ipc']});
  } else {
    appPort = await new Promise((r, reject) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p=s.address().port; s.close(e=>e?reject(e):r(p)); }); });
    env.PORT=String(appPort);
    child = spawn(process.execPath, [join(root,'.next/standalone/server.js')], {cwd:root, env, stdio:['ignore','pipe','pipe']});
  }
  child.stdout.on('data', b => process.stdout.write(b)); child.stderr.on('data', b => process.stderr.write(b));
  if (engine) appPort = await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Engine QA server did not announce its port')),60000);
    child.once('message', value=>{clearTimeout(timer); if(value?.mode==='engine-functional-QA' && Number.isInteger(value.port)) resolve(value.port); else reject(new Error('Invalid engine QA announcement'));});
    child.once('exit', code=>{clearTimeout(timer); reject(new Error(`Engine QA server exited: ${code}`));});
    child.once('error', error=>{clearTimeout(timer); reject(error);});
  });
  const base = `http://127.0.0.1:${appPort}`;
  let ready = false;
  for (let i=0;i<120;i++) { if (child.exitCode !== null) throw new Error(`App exited: ${child.exitCode}`); try { if ((await fetch(`${base}/api/health`, {signal:AbortSignal.timeout(1000)})).ok) {ready=true; break;} } catch {} await sleep(500); }
  assert.ok(ready, 'Standalone app did not start');
  if (engine) assert.equal((await (await fetch(`${base}/api/health`)).json()).mode,execution,'Unexpected engine QA health mode');
  // Run a real native-tool/schema prefill outside the measured suite. The app's
  // 30s deadline can close its connection while a cold model is still loading;
  // only this single owned warm request may continue until its 180s deadline.
  console.log(`[WARM] ${model} at ${upstream.origin}; native full-schema probe outside measured calls`);
  const warmUser = {id:randomUUID(),role:'user',parts:[{type:'text',text:'I need something for my morning coffee'}]};
  const warmInit={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contract:'shopping-v3',conversationId:randomUUID(),messages:[warmUser],cart:{lines:[]}}),signal:AbortSignal.timeout(engine?610000:40000)};
  if (engine) {
    const before=modelSuccesses;
    const response=await fetch(`${base}/api/chat`,warmInit);
    assert.equal(response.status,200,'Engine warm probe failed'); await response.arrayBuffer();
    assert.ok(modelSuccesses>before,'Engine warm probe did not complete a provider request');
    warming=false;
  } else {
    const warmApp=fetch(`${base}/api/chat`,warmInit).then(async r=>{await r.arrayBuffer();}).catch(()=>{});
    const warmed = await Promise.race([warmResult, new Promise(resolve=>{ const timer=setTimeout(()=>resolve({ok:false,error:'warm probe timed out'}),180000); timer.unref(); })]);
    await warmApp;
    assert.ok(warmed.ok, `Native warm probe failed: ${warmed.error ?? `HTTP ${warmed.status}`}`);
    warming = false;
  }
  const exportsJson = execFileSync(join(root,'node_modules/.bin/tsx'), ['-e', 'import {shoppingExamples,shoppingStarters} from "./src/application/chat/shopping-v3"; import {products} from "./src/data/products"; import {functionalGroups} from "./src/domain/catalog/functional-groups"; console.log(JSON.stringify({shoppingExamples,shoppingStarters,products,functionalGroups}))'], {cwd:root,encoding:'utf8'});
  const {shoppingExamples, shoppingStarters, products, functionalGroups} = JSON.parse(exportsJson.trim());
  const productById = new Map(products.map(p=>[p.id,p]));
  assert.equal(shoppingExamples.length, 10);
  let activeBatch;
  async function conversation() {
    const id = randomUUID(), messages = [], cart = new Map(), ledger = new Set();
    return async (text, action) => {
      const user = {id:randomUUID(),role:'user',parts:[{type:'text',text}], ...(action ? {metadata:{shoppingAction:action}} : {})};
      messages.push(user);
      const started = performance.now();
      const captured={text, ...(action?{action}:{}), startedAt:new Date().toISOString()};
      activeBatch.turns.push(captured);
      try {
      const response = await fetch(`${base}/api/chat`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contract:'shopping-v3',conversationId:id,messages,cart:{lines:[...cart].map(([productId,quantity])=>({productId,quantity}))}}),signal:AbortSignal.timeout(engine?610000:40000)});
      captured.httpStatus=response.status;
      assert.equal(response.status, 200, `App HTTP ${response.status}`);
      const raw = await response.text(); const ms = performance.now()-started;
      const events = raw.split(/\r?\n/).filter(s=>s.startsWith('data: ') && s !== 'data: [DONE]').map(s=>JSON.parse(s.slice(6)));
      const get = type => events.find(e=>e.type===`data-${type}`)?.data;
      const op=get('operation'), advice=get('advice'), state=get('shoppingState'), result=get('products'), comparison=get('comparison'), categories=get('categories'), cartAction=get('cartAction');
      const answer=events.filter(e=>e.type==='text-delta').map(e=>e.delta).join('');
      Object.assign(captured,{answer,operation:op,advice,checkpoint:state,result,comparison,categories,cartAction,usage:get('turnStatus')?.usage,elapsedMs:Math.round(ms)});
      assert.ok(!events.some(e=>e.type === 'error'), 'Stream error');
      assert.ok(op?.id && ['completed','needs-input','awaiting-device'].includes(op.status), `Operation ${op?.status ?? 'missing'}`);
      assert.ok(['not-requested','included','unavailable'].includes(advice?.status), 'Missing advice status');
      assert.equal(get('turnStatus')?.status, 'complete', 'Non-failed operation must remain complete');
      assert.ok(state?.after, 'Missing checkpoint');
      assert.ok(answer.trim(), 'Missing answer');
      assert.doesNotMatch(answer, /<\/?(?:think|analysis)>|\b(?:tool_call|presentAnswer|searchProducts|evidenceId)\b/);
      if (result) { assert.ok(result.products.length <= 10 && new Set(result.products.map(p=>p.id)).size === result.products.length); assert.ok(result.totalMatches <= result.scopeTotal && result.unseenMatches <= result.totalMatches); assert.equal(result.remainingMatches, result.unseenMatches - (result.newlyShownCount ?? result.products.length)); }
      if (cartAction && !ledger.has(cartAction.operationId)) { for (const item of cartAction.items ?? [cartAction]) cart.set(item.productId, (cart.get(item.productId)??0)+item.quantity); ledger.add(cartAction.operationId); }
      const parts=[{type:'text',text:answer}, ...events.filter(e=>['data-shoppingState','data-products','data-categories','data-comparison','data-turnStatus','data-operation','data-advice'].includes(e.type)).map(({type,data,id})=>({type,data,...(id?{id}:{})}))];
      messages.push({id:events.find(e=>e.type==='start')?.messageId??randomUUID(),role:'assistant',parts});
      if (!engine && (!action || action.type === 'advice')) assert.ok(ms < 32000, `AI app call exceeded 30s plus transport margin: ${Math.round(ms)}ms`);
      if (engine) console.log(`[ENGINE TURN] ${Math.round(ms)}ms (functional timing only)`);
      captured.validated=true; await save();
      return {op,advice,state:state.after,result,comparison,categories,cartAction,answer,ms};
      } catch(e) { captured.error=e.message; captured.elapsedMs=Math.round(performance.now()-started); await save(); throw e; }
    };
  }
  async function batch(name, fn) {
    const prior=old?.batches?.find(x=>x.name===name && x.passed);
    if (prior) { report.batches.push({...prior,reused:true,reusedFrom:{artifact:resume,...(guardRevision?{revision:guardRevision}:{}),fingerprint:old.fingerprint}}); await save(); console.log(`[RESUME] ${name}`); return; }
    const record={name,passed:false,turns:[]}; report.batches.push(record); activeBatch=record;
    const started=performance.now();
    try { await fn(); record.passed=true; console.log(`[PASS] ${name}`); } catch(e) { record.error=e.message; report.failures.push({name,error:e.message}); console.error(`[FAIL] ${name}: ${e.message}`); }
    record.durationMs=Math.round(performance.now()-started);
    activeBatch=undefined;
    await save();
  }
  await batch('smoke', async()=>{ const t=await conversation(); const before=modelCalls; const r=await t('I need something for my morning coffee'); assert.ok(modelCalls>before, 'Free message did not reach local model'); assert.ok(r.result?.products?.length, 'No coffee results'); });
  if (mode === 'suite') {
    const families=[
      ['discovery',['I need something for my morning coffee','Show only in-stock products'],['Szukam czegoś do porannej kawy','Pokaż tylko dostępne produkty']],
      ['garden',['Show me garden furniture under EUR 150','I need something to sit on'],['Pokaż meble ogrodowe do 150 EUR','Szukam czegoś do siedzenia']],
      ['categories',['What product categories do you have?'],['Jakie kategorie produktów macie w sklepie?']],
      ['comparison',['Compare mugs and carafe','Tell me more about the first product'],['Porównaj kubki i karafkę','Powiedz więcej o pierwszym produkcie']],
      ['correction',['Show me garden furniture under EUR 150','A plant pot is not furniture. Show me outdoor furniture'],['Pokaż meble ogrodowe do 150 EUR','Doniczka nie jest meblem. Pokaż meble do ogrodu']],
      ['cart',['Compare mugs and carafe','Add two of the cheaper option to my cart'],['Porównaj kubki i karafkę','Dodaj dwie sztuki tańszego produktu do koszyka']],
    ];
    for (const [name,en,pl] of families) for (const [lang,prompts] of [['en',en],['pl',pl]]) await batch(`${name}-${lang}`,async()=>{
      const t=await conversation(); let r;
      for(const [index,p] of prompts.entries()) {
        r=await t(p); assert.equal(r.state.language,lang);
        if(name==='discovery' && index===0) {
          const criteria=r.result?.appliedCriteria;
          assert.ok(criteria?.functionalGroup==='coffee' || functionalGroups.coffee.types.every(type=>criteria?.productTypes?.includes(type)), 'Coffee scope lacks functional group or full coffee types');
          assert.ok(r.result?.products.length>0,'Coffee results missing');
          assert.ok(r.result.products.every(row=>functionalGroups.coffee.types.includes(productById.get(row.id)?.productType)), 'Non-coffee result');
        }
        if(name==='garden') {
          assert.ok(r.result?.products.length>0,'Garden results missing');
          assert.equal(r.state.criteria.productKind,'furniture'); assert.equal(r.state.criteria.useEnvironment,'outdoor'); assert.equal(r.state.criteria.maxPrice,150);
          if(index===1) assert.ok(r.result.products.every(row=>functionalGroups.seating.types.includes(productById.get(row.id)?.productType)), 'Seating refinement includes non-seating products');
        }
        if(name==='categories') {assert.equal(r.categories?.length,10); assert.equal(r.categories.reduce((sum,row)=>sum+row.count,0),86);}
        if(name==='comparison' && index===0) {assert.deepEqual([...r.comparison.productIds].sort(),['carafe','mugs']); assert.ok(r.comparison.cheapestIds.includes('carafe'));}
        if(name==='correction' && index===1) {assert.ok(r.result?.products.length>0); assert.equal(r.state.criteria.productKind,'furniture'); assert.equal(r.state.criteria.useEnvironment,'outdoor');}
      }
      if(name==='cart') assert.equal(r.cartAction?.items?.find(x=>x.productId==='carafe')?.quantity,2);
    });
    for (const [kind,items] of [['starter',shoppingStarters],['example',shoppingExamples]]) for (const item of items) await batch(`${kind}-${item.label}`,async()=>{const t=await conversation(); const r=await t(item.text,item.action); if(item.action.type==='cart' || item.action.type==='more' || item.action.type==='availability') assert.equal(r.op.status,'needs-input'); else assert.equal(r.op.status,'completed'); if(item.action.type==='compare') assert.deepEqual([...r.comparison.productIds].sort(),['carafe','mugs']); if(item.action.type==='search') assert.ok(r.result?.products.length>0); });
    await batch('counts',async()=>{const t=await conversation(); for(const [text,n] of [["I'd like to see four products from the store.",4],['Please give me five products instead.',5],['Can you show ten products?',10],["I'd like twenty product suggestions.",20],['Show me everything in your shop.',1000]]) {const r=await t(text); assert.equal(r.result?.requestedCount,n); assert.equal(r.result?.products.length,Math.min(n,10));}});
    for (const n of [2,5,10]) await batch(`compare-${n}`,async()=>{const t=await conversation(); const found=await t('Show products',{type:'search',preset:'budget',requestedCount:10}); const ids=found.result.products.slice(0,n).map(x=>x.id); assert.equal(ids.length,n); const compared=await t('Compare these products',{type:'compare',productIds:ids}); assert.equal(compared.op.status,'completed'); assert.equal(compared.comparison?.productIds.length,n); });
    await batch('original-retry-new-polish-cart',async()=>{let t=await conversation(); let r=await t('I need something for my morning coffee',{type:'search',preset:'coffee'}); let ids=r.result.products.map(p=>p.id); r=await t('Compare these products',{type:'compare',productIds:ids}); assert.equal(r.op.status,'completed'); const cmp=r.op; const retry=await t('Explain differences',{type:'advice',operationId:cmp.id}); assert.equal(retry.op.status,'completed'); assert.ok(['included','unavailable'].includes(retry.advice.status)); t=await conversation(); r=await t('I need something for my morning coffee',{type:'search',preset:'coffee'}); ids=r.result.products.map(p=>p.id); r=await t('Compare these products',{type:'compare',productIds:ids}); assert.equal(r.comparison.productIds.length,ids.length); await t('Tell me more about the first product',{type:'details',productId:ids[0]}); r=await t('Dodaj do koszyka ten produkt, fajny jest'); assert.equal(r.state.language,'pl'); assert.equal(r.op.status,'awaiting-device'); assert.ok(r.cartAction); });
    await batch('twenty-turn-polish',async()=>{const t=await conversation(); const prompts=['Pisz po polsku. Pokaż meble ogrodowe do 150 EUR.','Szukam czegoś do siedzenia.','Pokaż inne propozycje.','Powiedz więcej o pierwszej propozycji.','Czy te produkty nadają się do ogrodu?','Pokaż tylko dostępne produkty.','Jaki nadal obowiązuje mój limit cenowy?','Porównaj kubki i karafkę.','Dodaj dwie sztuki tańszego produktu do koszyka.','Powiedz więcej o karafce.','Z czego jest zrobiona?','Jakie ma ograniczenia?','Ile kosztuje dostawa?','Jakie są zasady zwrotu?','Czy to sklep demonstracyjny?','Czy mogę obejrzeć szczegóły produktu?','Pisz dalej po polsku.','Przypomnij, który produkt z porównania był tańszy.','Jaką ilość wybrałem wcześniej?','Dziękuję za pomoc.']; assert.equal(prompts.length,20); for(const p of prompts) {const r=await t(p); assert.equal(r.state.language,'pl');} });
  }
  report.finished=new Date().toISOString(); await save();
  if(report.failures.length) {process.exitCode=1; console.error(`[FAIL] ${execution} ${mode}: ${report.failures.length}/${report.batches.length} batches failed; artifact ${artifact}.`);}
  else console.log(`[PASS] ${execution} ${mode}: ${report.batches.length} batches; artifact ${artifact}. Local model is not Groq acceptance${engine?' or HTTP latency acceptance':''}.`);
} catch(e) { report.error=e.message; report.finished=new Date().toISOString(); await save(); console.error(`[FAIL] ${e.message}; artifact ${artifact}`); process.exitCode=1; }
finally { shutdown(); if (child && child.exitCode === null) await Promise.race([new Promise(r=>child.once('exit',r)),sleep(3000).then(()=>child.kill('SIGKILL'))]); }
