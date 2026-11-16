import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateGardenConversation, validateGardenTurn, revalidateGarden } from '../scripts/revalidate-local-qa.mjs';

const run = (script: string, args: string[], extra: Record<string, string> = {}) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/groq|llama|proxy/i.test(key)));
  return spawnSync(process.execPath, [`scripts/${script}.mjs`, ...args], { encoding: 'utf8', env: { ...env, NODE_ENV: process.env.NODE_ENV, ...extra }, timeout: 5000 });
};

test('garden revalidation accepts closed furniture seating but rejects weaker or unsafe evidence', () => {
  const seating=['chair','bench','lounger','sofa','stool'];
  const types=Object.fromEntries([...seating.map(name=>[name,{kind:'furniture'}]),['garden-tool',{kind:'gardening'}]]);
  const groups={seating:{types:seating}};
  const products=new Map([
    ['chair',{id:'chair',productKind:'furniture',productType:'chair',useEnvironment:'outdoor',currency:'EUR',price:100}],
    ['bench',{id:'bench',productKind:'furniture',productType:'bench',useEnvironment:'both',currency:'EUR',price:150}],
    ['expensive',{id:'expensive',productKind:'furniture',productType:'chair',useEnvironment:'outdoor',currency:'EUR',price:151}],
    ['indoor',{id:'indoor',productKind:'furniture',productType:'chair',useEnvironment:'indoor',currency:'EUR',price:10}],
    ['trowel',{id:'trowel',productKind:'gardening',productType:'garden-tool',useEnvironment:'outdoor',currency:'EUR',price:10}],
  ]);
  const first={language:'pl',criteria:{productKind:'furniture',maxPrice:150,useEnvironment:'outdoor'}};
  const second={language:'pl',criteria:{functionalGroup:'seating',maxPrice:150,useEnvironment:'outdoor'}};
  const batch={name:'garden-pl',passed:false,error:"Expected values to be strictly equal:\n+ actual - expected\n\n+ undefined\n- 'furniture'\n",turns:[
    {text:'Pokaż meble ogrodowe do 150 EUR',httpStatus:200,validated:true,operation:{status:'completed',kind:'search'},checkpoint:{after:first},result:{products:[{id:'chair'}]}},
    {text:'Szukam czegoś do siedzenia',httpStatus:200,validated:true,operation:{status:'completed',kind:'search'},checkpoint:{before:first,after:second},result:{products:[{id:'chair'},{id:'bench'}]}},
  ]};
  validateGardenConversation(batch,'pl',products,types,groups);
  const fullTypes=structuredClone(batch.turns[1]); delete (fullTypes.checkpoint.after.criteria as {functionalGroup?:string}).functionalGroup; Object.assign(fullTypes.checkpoint.after.criteria,{productTypes:seating}); validateGardenTurn(fullTypes,1,products,types,groups);
  const mutate=(fn:(row:any)=>void)=>{const copy=structuredClone(batch);fn(copy);assert.throws(()=>validateGardenConversation(copy,'pl',products,types,groups));};
  mutate(copy=>{copy.turns[1].checkpoint.after.criteria.productTypes=['chair','garden-tool'];});
  mutate(copy=>{copy.turns[1].checkpoint.after.criteria.productTypes=['made-up'];});
  mutate(copy=>{delete copy.turns[1].checkpoint.after.criteria.functionalGroup;copy.turns[1].checkpoint.after.criteria.productTypes=['chair'];});
  mutate(copy=>{copy.turns[1].checkpoint.after.criteria.productKind='gardening';});
  mutate(copy=>{copy.turns[1].checkpoint.after.criteria.maxPrice=151;});
  mutate(copy=>{copy.turns[1].checkpoint.after.criteria.useEnvironment='indoor';});
  mutate(copy=>{copy.turns[1].result.products=[{id:'trowel'}];});
  mutate(copy=>{copy.turns[1].result.products=[{id:'expensive'}];});
  mutate(copy=>{copy.turns[1].result.products=[{id:'indoor'}];});
  mutate(copy=>{copy.turns[1].result.products=[{id:'unknown'}];});
  mutate(copy=>{copy.turns.pop();});
  mutate(copy=>{copy.turns[1].validated=false;});
  mutate(copy=>{copy.turns[1].operation.status='failed';});
  assert.throws(()=>validateGardenTurn(batch.turns[1],1,products,types,{seating:{types:['chair']}}));
  const report={batches:[{name:'garden-en',passed:false},batch],failures:[{name:'garden-pl',error:batch.error},{name:'comparison-pl',error:'independent failure'}]};
  const revised=revalidateGarden(report,products,types,groups,'/tmp/fixture.json',{sourceFingerprint:'fixture'});
  assert.equal(revised.batches[1].passed,true); assert.equal(revised.batches[1].originalError,batch.error); assert.deepEqual(revised.failures,[{name:'comparison-pl',error:'independent failure'}]); assert.equal(report.batches[1].passed,false);
  assert.throws(()=>revalidateGarden({...report,batches:[report.batches[0],{...batch,error:'Operation failed'}]},products,types,groups,'/tmp/fixture.json',{}));
});

test('garden revalidation cannot write from an unfinished run', () => {
  const dir=mkdtempSync(join(tmpdir(),'aurelle-garden-unfinished-'));
  const input=join(dir,'input.json'),output=join(dir,'output.json');
  try {
    writeFileSync(input,JSON.stringify({execution:'engine-functional-QA'}));
    const result=spawnSync(process.execPath,['scripts/revalidate-local-qa.mjs','--input',input,'--output',output],{encoding:'utf8',timeout:5000});
    assert.notEqual(result.status,0); assert.match(result.stderr,/original run must be finished/); assert.equal(existsSync(output),false);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('QA runners expose help without credentials or network traffic', () => {
  for (const script of ['agent-local', 'groq-canary']) {
    const result = run(script, ['--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);
  }
});

test('local runner refuses public model endpoints before launching a server', () => {
  const result = run('agent-local', ['--smoke'], { LLAMA_BASE_URL: 'https://api.groq.com/openai/v1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /private IPv4 or localhost/);
});

test('profile probe refuses forced reasoning or empty answers without logging reasoning text', () => {
  const dir=mkdtempSync(join(tmpdir(),'aurelle-profile-'));
  const path=join(dir,'profile.json');
  const inspect=(status:number,message:unknown)=>{writeFileSync(path,JSON.stringify({status,body:{choices:[{message}]}})); return run('agent-local',['--inspect-profile',path]);};
  try {
    const good=inspect(200,{content:'Ready.',reasoning_content:''}); assert.equal(good.status,0,good.stderr); assert.equal(JSON.parse(good.stdout).reasoningDisabled,true);
    for(const message of [{content:'',reasoning_content:'private reasoning fixture'},{content:'Ready.',reasoning_content:'private reasoning fixture'},{content:'Ready.',reasoning:{text:'private reasoning fixture'}},{content:'<think>private reasoning fixture</think>Ready.'}]) {
      const failed=inspect(200,message); assert.notEqual(failed.status,0); assert.match(failed.stderr,/thinking|reasoning/i); assert.doesNotMatch(failed.stderr,/private reasoning fixture/);
    }
    const http=inspect(503,{content:'Ready.'}); assert.notEqual(http.status,0); assert.match(http.stderr,/expected HTTP 200/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('guard-only resume proves historical source, runner and previously accepted queries', () => {
  const dir=mkdtempSync(join(tmpdir(),'aurelle-guard-resume-'));
  const git=(...args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const write=(path:string,value:string)=>writeFileSync(join(dir,path),value);
  const digest=(paths:string[])=>{const h=createHash('sha256'); for(const path of paths){const content=readFileSync(join(dir,path));h.update(`${path.length}:${path}:${content.length}:`);h.update(content);} return h.digest('hex');};
  try {
    git('init'); mkdirSync(join(dir,'scripts')); mkdirSync(join(dir,'src/application/chat'),{recursive:true});
    copyFileSync('scripts/agent-local.mjs',join(dir,'scripts/agent-local.mjs')); copyFileSync('scripts/revalidate-local-qa.mjs',join(dir,'scripts/revalidate-local-qa.mjs'));
    write('scripts/agent-local-core.ts','export {};\n');
    const originalGuard='export function queryLanguageError(query: string | undefined) { return query === "bad" ? {code:"QUERY_LANGUAGE"} : undefined; }\n';
    write('src/application/chat/query-language.ts',originalGuard); write('src/other.ts','export const value=1;\n'); write('package-lock.json','{}\n');
    symlinkSync(join(process.cwd(),'node_modules'),join(dir,'node_modules'),'dir');
    git('add','scripts','src','package-lock.json');
    git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','baseline');
    const revision=git('rev-parse','HEAD');
    const artifact=join(dir,'prior.json');
    const prior={fingerprint:digest(['src/application/chat/query-language.ts','src/other.ts','package-lock.json']),runnerHash:digest(['scripts/agent-local.mjs','scripts/agent-local-core.ts','scripts/revalidate-local-qa.mjs']),execution:'engine-functional-QA',model:'qwen38-uncensored',upstream:'http://172.20.0.1:8090/upstream/qwen38-uncensored/v1',profile:{reasoningDisabled:true,probe:'content-without-reasoning-v1'},batches:[{name:'passed',passed:true,turns:[{validated:true,checkpoint:{after:{criteria:{query:'morning coffee'}}},result:{appliedCriteria:{query:'morning coffee'}}}]},{name:'failed',passed:false,turns:[]}]};
    writeFileSync(artifact,JSON.stringify(prior));
    const invoke=(extra:string[]=[])=>spawnSync(process.execPath,[join(dir,'scripts/agent-local.mjs'),'--engine','--resume',artifact,'--query-guard-revision',revision,'--inspect-resume',...extra],{cwd:dir,encoding:'utf8',env:{PATH:process.env.PATH,NODE_ENV:process.env.NODE_ENV},timeout:15000});
    const unchanged=invoke(); assert.notEqual(unchanged.status,0); assert.match(unchanged.stderr,/Only the query-language guard may differ/);
    write('src/application/chat/query-language.ts',`${originalGuard}// verified adjustment\n`);
    const accepted=invoke(); assert.equal(accepted.status,0,accepted.stderr);
    const proof=JSON.parse(accepted.stdout); assert.equal(proof.originalRevision,revision); assert.deepEqual(proof.checkedQueries,['morning coffee']); assert.deepEqual(proof.reusedBatches,['passed']);
    const {profile: _profile,...legacy}=prior; writeFileSync(artifact,JSON.stringify(legacy)); const oldProfile=invoke(); assert.notEqual(oldProfile.status,0); assert.match(oldProfile.stderr,/Local model profile changed or was not verified/); writeFileSync(artifact,JSON.stringify(prior));
    const strict=spawnSync(process.execPath,[join(dir,'scripts/agent-local.mjs'),'--engine','--resume',artifact],{cwd:dir,encoding:'utf8',env:{PATH:process.env.PATH,NODE_ENV:process.env.NODE_ENV},timeout:15000});
    assert.notEqual(strict.status,0); assert.match(strict.stderr,/Source\/build fingerprint changed/);
    write('src/other.ts','export const value=2;\n'); const other=invoke(); assert.notEqual(other.status,0); assert.match(other.stderr,/Only the query-language guard may differ/); write('src/other.ts','export const value=1;\n');
    write('src/added.ts','export const value=3;\n'); const added=invoke(); assert.notEqual(added.status,0); assert.match(added.stderr,/Source paths differ/); rmSync(join(dir,'src/added.ts'));
    write('package-lock.json','{"changed":true}\n'); const lock=invoke(); assert.notEqual(lock.status,0); assert.match(lock.stderr,/Only the query-language guard may differ/); write('package-lock.json','{}\n');
    writeFileSync(artifact,JSON.stringify({...prior,runnerHash:'0'.repeat(64)})); const forged=invoke(); assert.notEqual(forged.status,0); assert.match(forged.stderr,/Original revision does not match artifact runner fingerprint/); writeFileSync(artifact,JSON.stringify(prior));
    write('src/application/chat/query-language.ts','export function queryLanguageError(q: string | undefined) { return q === "morning coffee" ? {code:"QUERY_LANGUAGE"} : undefined; }\n');
    const rejected=invoke(); assert.notEqual(rejected.status,0); assert.match(rejected.stderr,/previously passing query was rejected/);
    write('src/application/chat/query-language.ts',`${originalGuard}// verified adjustment\n`); write('scripts/agent-local-core.ts','export const changed=true;\n');
    const helper=invoke(); assert.notEqual(helper.status,0); assert.match(helper.stderr,/Engine helper changed/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('facet-only resume rejects any prior search naming a canonical kind and unrelated changes', () => {
  const dir=mkdtempSync(join(tmpdir(),'aurelle-facet-resume-'));
  const git=(...args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const write=(path:string,value:string)=>writeFileSync(join(dir,path),value);
  const digest=(paths:string[])=>{const h=createHash('sha256'); for(const path of paths){const content=readFileSync(join(dir,path));h.update(`${path.length}:${path}:${content.length}:`);h.update(content);} return h.digest('hex');};
  try {
    git('init'); mkdirSync(join(dir,'scripts')); mkdirSync(join(dir,'src/application/chat'),{recursive:true}); mkdirSync(join(dir,'src/domain/catalog'),{recursive:true});
    copyFileSync('scripts/agent-local.mjs',join(dir,'scripts/agent-local.mjs')); copyFileSync('scripts/revalidate-local-qa.mjs',join(dir,'scripts/revalidate-local-qa.mjs')); write('scripts/agent-local-core.ts','export {};\n');
    const facets='export function resolveExplicitFacets(_text: string, _before: unknown, change: unknown, _filters: unknown[]) { return {change}; }\n', taxonomy='export const productKinds={furniture:{en:"furniture",pl:"meble",aliases:["furnishing","mebl"]},lighting:{en:"lighting",pl:"oświetlenie",aliases:["lampy"]}};\n';
    write('src/application/chat/explicit-facets.ts',facets); write('src/application/chat/query-language.ts','export function queryLanguageError(q: string | undefined) { return q === "bad" ? {error:"invalid"} : undefined; }\n'); write('src/domain/catalog/taxonomy.ts',taxonomy); write('src/other.ts','export const value=1;\n'); write('package-lock.json','{}\n');
    symlinkSync(join(process.cwd(),'node_modules'),join(dir,'node_modules'),'dir');
    git('add','scripts','src','package-lock.json'); git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','baseline');
    const revision=git('rev-parse','HEAD'), artifact=join(dir,'prior.json');
    const turn={text:'I need something for my morning coffee',validated:true,operation:{kind:'search'},checkpoint:{before:{criteria:{}},transition:{operation:'new',language:'en',criteria:{query:'morning coffee'}},after:{criteria:{query:'morning coffee'}}}};
    const prior={fingerprint:digest(['src/application/chat/explicit-facets.ts','src/application/chat/query-language.ts','src/domain/catalog/taxonomy.ts','src/other.ts','package-lock.json']),runnerHash:digest(['scripts/agent-local.mjs','scripts/agent-local-core.ts','scripts/revalidate-local-qa.mjs']),execution:'engine-functional-QA',model:'qwen38-uncensored',upstream:'http://172.20.0.1:8090/upstream/qwen38-uncensored/v1',profile:{reasoningDisabled:true,probe:'content-without-reasoning-v1'},batches:[{name:'coffee',passed:true,turns:[turn]},{name:'failed',passed:false,turns:[{...turn,text:'garden furniture'}]}]};
    writeFileSync(artifact,JSON.stringify(prior)); write('src/application/chat/explicit-facets.ts',`${facets}// bounded fix\n`);
    const invoke=(extra:string[]=[])=>spawnSync(process.execPath,[join(dir,'scripts/agent-local.mjs'),'--engine','--resume',artifact,'--facet-guard-revision',revision,'--inspect-resume',...extra],{cwd:dir,encoding:'utf8',env:{PATH:process.env.PATH,NODE_ENV:process.env.NODE_ENV},timeout:15000});
    const accepted=invoke(); assert.equal(accepted.status,0,accepted.stderr);
    const proof=JSON.parse(accepted.stdout); assert.equal(proof.kind,'facet-guard-only'); assert.equal(proof.originalRevision,revision); assert.deepEqual(proof.reusedBatches,['coffee']); assert.deepEqual(proof.checkedSearches.map((row:{text:string})=>row.text),[turn.text]); assert.equal(proof.replayedSearches,1);
    for(const text of ['Show me garden furniture','Bez mebli proszę','Pokaż oswietlenie']) {
      writeFileSync(artifact,JSON.stringify({...prior,batches:[{name:'unsafe',passed:true,turns:[{...turn,text}]}]}));
      const rejected=invoke(); assert.notEqual(rejected.status,0); assert.match(rejected.stderr,/previously passing search contains a canonical kind alias/);
    }
    writeFileSync(artifact,JSON.stringify(prior));
    write('src/application/chat/explicit-facets.ts','export function resolveExplicitFacets(_t: string, _b: unknown, change: any) { return {change:{...change,criteria:{...change.criteria,maxPrice:150}}}; }\n');
    const changedReplay=invoke(); assert.notEqual(changedReplay.status,0); assert.match(changedReplay.stderr,/previously passing search fails facet replay/);
    write('src/application/chat/explicit-facets.ts','export function resolveExplicitFacets() { return {error:"invalid"}; }\n');
    const errorReplay=invoke(); assert.notEqual(errorReplay.status,0); assert.match(errorReplay.stderr,/previously passing search fails facet replay/);
    write('src/application/chat/explicit-facets.ts',`${facets}// bounded fix\n`);
    writeFileSync(artifact,JSON.stringify({...prior,batches:[{name:'missing',passed:true,turns:[{...turn,checkpoint:{before:turn.checkpoint.before,after:turn.checkpoint.after}}]}]}));
    const missingTransition=invoke(); assert.notEqual(missingTransition.status,0); assert.match(missingTransition.stderr,/Missing search transition or prior state/);
    writeFileSync(artifact,JSON.stringify({...prior,batches:[{name:'query',passed:true,turns:[{...turn,checkpoint:{...turn.checkpoint,after:{criteria:{query:'bad'}}}}]}]}));
    const invalidQuery=invoke(); assert.notEqual(invalidQuery.status,0); assert.match(invalidQuery.stderr,/previously passing search fails facet replay/);
    writeFileSync(artifact,JSON.stringify(prior));
    const combined=invoke(['--query-guard-revision',revision]); assert.notEqual(combined.status,0); assert.match(combined.stderr,/exceptions cannot be combined/);
    write('src/domain/catalog/taxonomy.ts',`${taxonomy}// changed\n`); const other=invoke(); assert.notEqual(other.status,0); assert.match(other.stderr,/Only the explicit-facets guard may differ/); write('src/domain/catalog/taxonomy.ts',taxonomy);
    write('package-lock.json','{"changed":true}\n'); const lock=invoke(); assert.notEqual(lock.status,0); assert.match(lock.stderr,/Only the explicit-facets guard may differ/); write('package-lock.json','{}\n');
    write('src/added.ts','export const added=1;\n'); const added=invoke(); assert.notEqual(added.status,0); assert.match(added.stderr,/Source paths differ/); rmSync(join(dir,'src/added.ts'));
    writeFileSync(artifact,JSON.stringify({...prior,runnerHash:'0'.repeat(64)})); const forged=invoke(); assert.notEqual(forged.status,0); assert.match(forged.stderr,/Original revision does not match artifact runner fingerprint/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('contract resume selectively excludes changed parsing, prior copy, comparisons, carts and actions', () => {
  const dir=mkdtempSync(join(tmpdir(),'aurelle-contract-resume-'));
  const git=(...args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const write=(path:string,value:string)=>writeFileSync(join(dir,path),value);
  const digest=(paths:string[])=>{const h=createHash('sha256');for(const path of paths){const content=readFileSync(join(dir,path));h.update(`${path.length}:${path}:${content.length}:`);h.update(content);}return h.digest('hex');};
  try {
    git('init'); for(const p of ['scripts','src/application/catalog','src/application/chat','src/infrastructure/chat']) mkdirSync(join(dir,p),{recursive:true});
    copyFileSync('scripts/agent-local.mjs',join(dir,'scripts/agent-local.mjs')); copyFileSync('scripts/revalidate-local-qa.mjs',join(dir,'scripts/revalidate-local-qa.mjs')); write('scripts/agent-local-core.ts','export {};\n');
    const parser='export function parseSearchIntent(c: any) { return {...c}; }\n';
    const native='for (let step = 0; step < 4; step++) {\nconst forceAnswer = step === 3 || terminalOnly;\nconst { proposeCart: _cartTool, ...readTools } = nativeTools;\nif (terminalOnly) {\n}\ngenerated = await generateText({\n model,\n        });\nif (correction || step === 3) break;\n}\n';
    const reviewedNative='let productComparisonPending = false;\nif (!turn.action && !hasCartInstruction(turn.text) && directComparisonRequest(turn.text)) { productComparisonPending = true; }\nif (productComparisonPending && usage.calls >= 4) break;\n'+native.replace('for (let step = 0; step < 4; step++)','for (let step = 0; step < (productComparisonPending ? 5 : 4); step++)').replace('const forceAnswer = step === 3 || terminalOnly;','const forceAnswer = (productComparisonPending ? usage.calls >= 3 && expectedRead !== "compareProducts" : step === 3) || terminalOnly;').replace('if (correction || step === 3) break;','if (correction || (productComparisonPending ? usage.calls >= 4 : step === 3)) break;');
    write('src/application/catalog/search-intent.ts',parser);
    write('src/application/chat/cart-authorization.ts','export function hasCartInstruction(t: string) { return /add|dodaj/i.test(t); }\n');
    write('src/application/chat/cart-intent.ts','export const unchanged=1;\n');
    write('src/application/chat/operation-summary.ts','export const searchSummary=(v: any)=>v.summary; export const detailsSummary=()=>"detail"; export const categoriesSummary=()=>"categories"; export const comparisonSummary=()=>"compare";\n');
    write('src/infrastructure/chat/native-agent.ts',native); write('src/other.ts','export const other=1;\n'); write('package-lock.json','{}\n');
    symlinkSync(join(process.cwd(),'node_modules'),join(dir,'node_modules'),'dir');
    git('add','scripts','src','package-lock.json'); git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','baseline');
    const revision=git('rev-parse','HEAD'), artifact=join(dir,'prior.json');
    const turn=(text:string,query:string,answer:string,summary:string,lang='en')=>({text,answer,validated:true,operation:{kind:'search',status:'completed'},checkpoint:{before:{criteria:{query}},transition:{criteria:{query}},after:{language:lang,criteria:{query}}},result:{appliedCriteria:{query},summary}});
    const a=turn('morning coffee','coffee','stable','stable'),last=turn('available','coffee','old last','new last');
    const batches=[
      {name:'compatible',passed:true,turns:[a,last]},
      {name:'parser',passed:true,turns:[turn('ordinary','generic','stable','stable')]},
      {name:'copy',passed:true,turns:[turn('morning coffee','coffee','old first','new first'),last]},
      {name:'polish-copy',passed:true,turns:[turn('poranna kawa','coffee','dawne podsumowanie','nowe podsumowanie','pl'),turn('inne','coffee','stare','nowe','pl')]},
      {name:'comparison',passed:true,turns:[turn('Porównaj kubki','coffee','stable','stable')]},
      {name:'implicit-comparison',passed:true,turns:[{...a,text:'Which is better?',operation:{kind:'comparison'},comparison:{productIds:['mugs','carafe']}}]},
      {name:'cart',passed:true,turns:[turn('Add one to cart','coffee','stable','stable')]},
      {name:'implicit-cart',passed:true,turns:[{...a,text:'Yes',operation:{kind:'cart'}}]},
      {name:'pending-context',passed:true,turns:[{...a,checkpoint:{...a.checkpoint,before:{...a.checkpoint.before,pendingCartIntent:'fixture'}}}]},
      {name:'action',passed:true,turns:[{...a,action:{type:'search'}}]},
      {name:'failed',passed:false,turns:[]},
    ];
    const paths=['src/application/catalog/search-intent.ts','src/application/chat/cart-authorization.ts','src/application/chat/cart-intent.ts','src/application/chat/operation-summary.ts','src/infrastructure/chat/native-agent.ts','src/other.ts','package-lock.json'];
    const prior={fingerprint:digest(paths),runnerHash:digest(['scripts/agent-local.mjs','scripts/agent-local-core.ts','scripts/revalidate-local-qa.mjs']),execution:'engine-functional-QA',model:'qwen38-uncensored',upstream:'http://172.20.0.1:8090/upstream/qwen38-uncensored/v1',profile:{reasoningDisabled:true,probe:'content-without-reasoning-v1'},batches};
    writeFileSync(artifact,JSON.stringify(prior));
    write('src/application/catalog/search-intent.ts','export function parseSearchIntent(c: any) { return {...c,query:c.query === "generic" ? "" : c.query}; }\n');
    write('src/infrastructure/chat/native-agent.ts',`${reviewedNative}// reviewed comparison branch\n`);
    const invoke=(extra:string[]=[])=>spawnSync(process.execPath,[join(dir,'scripts/agent-local.mjs'),'--engine','--resume',artifact,'--contract-revision',revision,'--inspect-resume',...extra],{cwd:dir,encoding:'utf8',env:{PATH:process.env.PATH,NODE_ENV:process.env.NODE_ENV},timeout:15000});
    const result=invoke(); assert.equal(result.status,0,result.stderr);
    const proof=JSON.parse(result.stdout); assert.equal(proof.kind,'reviewed-contract'); assert.deepEqual(proof.reusedBatches,['compatible']);
    const decisions=new Map(proof.decisions.map((row:{name:string})=>[row.name,row]));
    for(const [name,reason] of [['parser','search-parser-changed'],['copy','history-summary-changed'],['polish-copy','history-summary-changed'],['comparison','comparison-instruction'],['implicit-comparison','comparison-operation'],['cart','cart-instruction'],['implicit-cart','cart-operation'],['pending-context','pending-cart-context'],['action','structural-action']] as const) assert.ok((decisions.get(name) as {reasons:string[]}).reasons.includes(reason));
    assert.equal((decisions.get('compatible') as {lastSummary:{recomputedAnswer:string;identical:boolean}}).lastSummary.recomputedAnswer,'new last');
    assert.equal((decisions.get('compatible') as {lastSummary:{identical:boolean}}).lastSummary.identical,false);
    assert.deepEqual((decisions.get('failed') as {reasons:string[]}).reasons,['previously-failed-or-unfinished']);
    write('src/other.ts','export const other=2;\n'); const unrelated=invoke(); assert.notEqual(unrelated.status,0); assert.match(unrelated.stderr,/only the five reviewed application files/); write('src/other.ts','export const other=1;\n');
    write('src/infrastructure/chat/native-agent.ts',reviewedNative.replace(' model,',' changedModel,')); const prompt=invoke(); assert.notEqual(prompt.status,0); assert.match(prompt.stderr,/Model prompt, tool selection or call options changed/);
    write('src/infrastructure/chat/native-agent.ts',reviewedNative.replace('productComparisonPending ? 5 : 4','5')); const ungated=invoke(); assert.notEqual(ungated.status,0); assert.match(ungated.stderr,/Non-comparison execution controls are not the reviewed gated version/);
    write('src/infrastructure/chat/native-agent.ts',`${reviewedNative}\nproductComparisonPending = true;`); const extraGate=invoke(); assert.notEqual(extraGate.status,0); assert.match(extraGate.stderr,/Comparison pending state is not exclusively set/);
    const mixed=invoke(['--facet-guard-revision',revision]); assert.notEqual(mixed.status,0); assert.match(mixed.stderr,/exceptions cannot be combined/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('engine QA helper rejects unsafe providers, routes, keys and public bind before starting', () => {
  const base={PATH:process.env.PATH,NODE_ENV:process.env.NODE_ENV,CHAT_PROVIDER:'llama',LLAMA_MODEL:'qwen38-uncensored',LLAMA_BASE_URL:'http://127.0.0.1:1/v1',HOSTNAME:'127.0.0.1',EMBEDDING_MODEL:'minilm'};
  const invoke=(extra:Record<string,string>, args:string[]=[])=>spawnSync(process.execPath,['--import','tsx','scripts/agent-local-core.ts',...args],{encoding:'utf8',env:{...base,...extra},timeout:5000});
  const help=invoke({},['--help']); assert.equal(help.status,0,help.stderr); assert.match(help.stdout,/ENGINE functional QA/);
  for(const [override,pattern] of [
    [{CHAT_PROVIDER:'groq'},/requires CHAT_PROVIDER=llama/],
    [{LLAMA_MODEL:'other'},/requires LLAMA_MODEL/],
    [{LLAMA_BASE_URL:'http://10.0.0.1:1/v1'},/requires a loopback llama proxy/],
    [{GROQ_API_KEY:'fixture'},/refuses Groq keys and routes/],
    [{HOSTNAME:'0.0.0.0'},/requires loopback binding/],
  ] as [Record<string,string>,RegExp][]) {
    const result=invoke(override); assert.notEqual(result.status,0); assert.match(result.stderr,pattern);
  }
});

test('engine QA helper serves real deterministic comparison over loopback without a model call', async () => {
  const env={PATH:process.env.PATH,NODE_ENV:process.env.NODE_ENV,CHAT_PROVIDER:'llama',LLAMA_MODEL:'qwen38-uncensored',LLAMA_BASE_URL:'http://127.0.0.1:1/v1',HOSTNAME:'127.0.0.1',EMBEDDING_MODEL:'minilm'};
  const child=spawn(process.execPath,['--import','tsx','scripts/agent-local-core.ts'],{env,stdio:['ignore','pipe','pipe','ipc']});
  let errors=''; child.stderr?.on('data',chunk=>{errors+=chunk.toString();});
  try {
    const info=await new Promise<{mode:string;port:number}>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Engine server startup timed out')),5000);
      child.once('message',value=>{clearTimeout(timer); resolve(value as {mode:string;port:number});});
      child.once('exit',code=>{clearTimeout(timer); reject(new Error(`Engine exited ${code}: ${errors}`));});
      child.once('error',reject);
    });
    assert.equal(info.mode,'engine-functional-QA');
    const base=`http://127.0.0.1:${info.port}`;
    const health=await (await fetch(`${base}/api/health`)).json() as {mode:string}; assert.equal(health.mode,'engine-functional-QA');
    const response=await fetch(`${base}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contract:'shopping-v3',conversationId:'fixture',messages:[{id:'fixture',role:'user',parts:[{type:'text',text:'Compare mugs and carafe'}],metadata:{shoppingAction:{type:'compare',productIds:['mugs','carafe']}}}],cart:{lines:[]}}),signal:AbortSignal.timeout(5000)});
    assert.equal(response.status,200,errors);
    const events=(await response.text()).split(/\r?\n/).filter(s=>s.startsWith('data: ') && s!=='data: [DONE]').map(s=>JSON.parse(s.slice(6)));
    assert.equal(events.find(e=>e.type==='data-operation')?.data.status,'completed');
    assert.deepEqual(events.find(e=>e.type==='data-comparison')?.data.productIds,['mugs','carafe']);
  } finally {child.kill('SIGTERM'); await new Promise<void>(resolve=>{if(child.exitCode!==null) resolve(); else child.once('exit',()=>resolve());});}
});

test('canary refuses malformed releases and missing caller credentials', () => {
  const invalid = run('groq-canary', ['--release', 'invalid']);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /full lowercase Git SHA/);
  const head = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const missing = run('groq-canary', ['--release', head]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /GROQ_API_KEY must be present/);
});

test('continuation preserves the root ledger and public usage is reserved and settled', () => {
  const dir=mkdtempSync(join(tmpdir(),'aurelle-qa-release-'));
  const git=(...args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  let ledgerPath='';
  try {
    git('init');
    mkdirSync(join(dir,'scripts'));
    copyFileSync('scripts/groq-canary.mjs',join(dir,'scripts/groq-canary.mjs'));
    writeFileSync(join(dir,'change.txt'),'first'); git('add','change.txt');
    git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','first');
    const root=git('rev-parse','HEAD');
    writeFileSync(join(dir,'change.txt'),'second'); git('add','change.txt');
    git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','second');
    const head=git('rev-parse','HEAD');
    ledgerPath=join('/tmp',`aurelle-groq-canary-${root}.json`);
    writeFileSync(ledgerPath,JSON.stringify({release:root,limit:8000,charged:3517,requests:[]}));
    // A changed TMPDIR must never start a fresh release budget.
    const invoke=(args:string[])=>spawnSync(process.execPath,[join(dir,'scripts/groq-canary.mjs'),...args],{cwd:dir,encoding:'utf8',env:{PATH:process.env.PATH,NODE_ENV:process.env.NODE_ENV,TMPDIR:dir,GROQ_API_KEY:'fixture-only'},timeout:5000});
    const reset=invoke(['--release',head]);
    assert.notEqual(reset.status,0); assert.match(reset.stderr,/Existing ancestor release ledger/);
    const missingProof=invoke(['--release',head,'--continue-release',root,'--advice-only']);
    assert.notEqual(missingProof.status,0); assert.match(missingProof.stderr,/Missing or invalid previous free-message evidence/);
    const reserved=invoke(['--release',head,'--continue-release',root,'--reserve-public','--amount','500']);
    assert.equal(reserved.status,0,reserved.stderr);
    const pending=JSON.parse(readFileSync(ledgerPath,'utf8'));
    assert.equal(pending.charged,4017); assert.equal(pending.requests[0].stage,'public');
    assert.equal(pending.requests[0].sourceRevision,head);
    const id=pending.requests[0].id;
    const settled=invoke(['--release',head,'--continue-release',root,'--settle-public','--reservation',id,'--input','200','--cached','50','--output','100']);
    assert.equal(settled.status,0,settled.stderr);
    const result=JSON.parse(readFileSync(ledgerPath,'utf8'));
    assert.equal(result.charged,3767); assert.equal(result.requests[0].usage.uncached,250);
  } finally { if(ledgerPath) rmSync(ledgerPath,{force:true}); rmSync(dir,{recursive:true,force:true}); }
});

test('canary reserves before traffic and settles actual uncached usage across invocations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurelle-qa-budget-'));
  const ledgerPath = join(dir, 'ledger.json'), fixture = join(dir, 'fixture.json');
  const inspect = (operations: unknown[]) => {
    writeFileSync(fixture, JSON.stringify({ledgerPath, operations}));
    return run('groq-canary', ['--inspect-budget', fixture]);
  };
  try {
    const first = inspect([{type:'reserve', tokens:1000, maxOutput:512}, {type:'settle', usage:{input:800, cached:100, output:100}}]);
    assert.equal(first.status, 0, first.stderr);
    let ledger = JSON.parse(first.stdout);
    assert.equal(ledger.requests[0].reserved, 3012);
    assert.equal(ledger.charged, 800);
    const second = inspect([{type:'reserve', tokens:3000, maxOutput:256}, {type:'settle', usage:{input:300, cached:0, output:100}}]);
    assert.equal(second.status, 0, second.stderr);
    ledger = JSON.parse(second.stdout);
    assert.equal(ledger.requests[1].reserved, 6256);
    assert.equal(ledger.charged, 1200);
    const blocked = inspect([{type:'reserve', tokens:4000, maxOutput:512}]);
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /Budget exhausted/);
    assert.equal(JSON.parse(readFileSync(ledgerPath, 'utf8')).charged, 1200);
  } finally { rmSync(dir, {recursive:true, force:true}); }
});

test('canary retains unknown usage and denies later calls or retries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurelle-qa-budget-'));
  const ledgerPath = join(dir, 'ledger.json'), fixture = join(dir, 'fixture.json');
  const inspect = (operations: unknown[]) => {
    writeFileSync(fixture, JSON.stringify({ledgerPath, operations}));
    return run('groq-canary', ['--inspect-budget', fixture]);
  };
  try {
    const missing = inspect([{type:'reserve', tokens:1000, maxOutput:256}, {type:'settle'}]);
    assert.equal(missing.status, 0, missing.stderr);
    const ledger = JSON.parse(missing.stdout);
    assert.equal(ledger.charged, 2756);
    assert.equal(ledger.requests[0].status, 'usage-unavailable-reservation-retained');
    const retry = inspect([{type:'reserve', tokens:1, maxOutput:1}]);
    assert.notEqual(retry.status, 0);
    assert.match(retry.stderr, /Unsettled usage or reservation/);
    assert.equal(JSON.parse(readFileSync(ledgerPath, 'utf8')).charged, 2756);
  } finally { rmSync(dir, {recursive:true, force:true}); }
});

test('canary records unexpectedly high actual usage and freezes the release', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurelle-qa-budget-'));
  const ledgerPath = join(dir, 'ledger.json'), fixture = join(dir, 'fixture.json');
  try {
    writeFileSync(fixture, JSON.stringify({ledgerPath, operations:[{type:'reserve', tokens:100, maxOutput:256}, {type:'settle', usage:{input:8100, cached:0, output:100}}]}));
    const result = run('groq-canary', ['--inspect-budget', fixture]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Actual usage exceeded estimate/);
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    assert.equal(ledger.charged, 8200);
    assert.equal(ledger.requests[0].status, 'under-reserved');
    writeFileSync(fixture, JSON.stringify({ledgerPath, operations:[{type:'reserve', tokens:1, maxOutput:1}]}));
    const retry = run('groq-canary', ['--inspect-budget', fixture]);
    assert.notEqual(retry.status, 0);
    assert.match(retry.stderr, /Unsettled usage or reservation/);
  } finally { rmSync(dir, {recursive:true, force:true}); }
});

test('overview guard resume pins the exact delta and rejects affected or unproven batches', () => {
  const dir=mkdtempSync(join(tmpdir(),'aurelle-overview-resume-'));
  const git=(...args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const write=(path:string,value:string)=>writeFileSync(join(dir,path),value);
  const digest=(paths:string[])=>{const h=createHash('sha256'); for(const path of paths){const content=readFileSync(join(dir,path));h.update(`${path.length}:${path}:${content.length}:`);h.update(content);} return h.digest('hex');};
  try {
    git('init'); mkdirSync(join(dir,'scripts')); mkdirSync(join(dir,'src/infrastructure/chat'),{recursive:true});
    for(const name of ['agent-local.mjs','agent-local-core.ts','revalidate-local-qa.mjs']) copyFileSync(`scripts/${name}`,join(dir,'scripts',name));
    const native='src/infrastructure/chat/native-agent.ts';
    const before='export const overviewGuard = false;\n';
    const after='export const overviewGuard = true;\n';
    const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
    const fixtureRunner=readFileSync(join(dir,'scripts/agent-local.mjs'),'utf8');
    const originalPin=/sha\(revisionContent\(nativePath\)\),'[a-f0-9]{64}'/;
    const currentPin=/sha\(await readFile\(join\(root,nativePath\)\)\),'[a-f0-9]{64}'/;
    assert.match(fixtureRunner,originalPin); assert.match(fixtureRunner,currentPin);
    write('scripts/agent-local.mjs',fixtureRunner.replace(originalPin,`sha(revisionContent(nativePath)),'${sha(before)}'`).replace(currentPin,`sha(await readFile(join(root,nativePath))),'${sha(after)}'`));
    write(native,before); write('src/other.ts','export {};\n'); write('package-lock.json','{}\n');
    git('add','scripts','src','package-lock.json'); git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','baseline');
    const revision=git('rev-parse','HEAD'), artifact=join(dir,'prior.json');
    const turn=(text:string,seconds:number,calls:number)=>({text,startedAt:`2026-01-01T00:00:${String(seconds).padStart(2,'0')}.000Z`,elapsedMs:900,usage:{calls},validated:true,checkpoint:{after:{criteria:{}}}});
    const batches=[{name:'safe',passed:true,turns:[turn('Compare mugs and carafe',1,1)]},{name:'affected',passed:true,turns:[turn('Porównaj kubki i karafkę',3,1)]},{name:'missing',passed:true,turns:[turn('Compare products',5,1)]},{name:'inherited',passed:true,reused:true,turns:[turn('Products',7,0)]},{name:'failed',passed:false,turns:[]}];
    const prior={fingerprint:digest([native,'src/other.ts','package-lock.json']),runnerHash:digest(['scripts/agent-local.mjs','scripts/agent-local-core.ts','scripts/revalidate-local-qa.mjs']),execution:'engine-functional-QA',model:'qwen38-uncensored',upstream:'http://172.20.0.1:8090/upstream/qwen38-uncensored/v1',profile:{reasoningDisabled:true,probe:'content-without-reasoning-v1'},batches};
    writeFileSync(artifact,JSON.stringify(prior));
    const request=(second:string)=>({kind:'request',at:`2026-01-01T00:00:${second}.100Z`,body:{}});
    const response=(second:string,name:string)=>({kind:'response',at:`2026-01-01T00:00:${second}.200Z`,status:200,choices:[{toolCalls:[{function:{name}}]}]});
    const events=[request('01'),response('01','searchProducts'),request('03'),response('03','getCatalogOverview'),request('05')];
    const saveTrace=()=>writeFileSync(artifact+'.provider.jsonl',events.map(e=>JSON.stringify(e)).join('\n')+'\n'); saveTrace();
    write(native,after);
    const invoke=()=>spawnSync(process.execPath,[join(dir,'scripts/agent-local.mjs'),'--engine','--resume',artifact,'--overview-guard-revision',revision,'--inspect-resume'],{cwd:dir,encoding:'utf8',env:{PATH:process.env.PATH,NODE_ENV:process.env.NODE_ENV},timeout:15000});
    let result=invoke(); assert.equal(result.status,0,result.stderr); let proof=JSON.parse(result.stdout);
    assert.deepEqual(proof.reusedBatches,['safe']);
    const decisions=new Map(proof.decisions.map((row:{name:string})=>[row.name,row]));
    for(const [name,reason] of [['affected','overview-during-comparison'],['missing','unattributable-provider-trace'],['inherited','inherited-proof-not-revalidated'],['failed','previously-failed-or-unfinished']] as const) assert.ok((decisions.get(name) as {reasons:string[]}).reasons.includes(reason));
    events[1]=response('01','getCatalogOverview'); saveTrace(); result=invoke(); assert.equal(result.status,0,result.stderr); proof=JSON.parse(result.stdout); assert.deepEqual(proof.reusedBatches,[]);
    events[1]=response('01','searchProducts'); saveTrace();
    write(native,after+'\n// unrelated change\n'); result=invoke(); assert.notEqual(result.status,0); assert.match(result.stderr,/Unreviewed overview guard delta/); write(native,after);
    write('src/other.ts','export const changed=1;\n'); result=invoke(); assert.notEqual(result.status,0); assert.match(result.stderr,/only the reviewed native agent change/); write('src/other.ts','export {};\n');
    write('scripts/revalidate-local-qa.mjs',readFileSync('scripts/revalidate-local-qa.mjs','utf8')+'\n// changed'); result=invoke(); assert.notEqual(result.status,0); assert.match(result.stderr,/QA validator changed/);
    copyFileSync('scripts/revalidate-local-qa.mjs',join(dir,'scripts/revalidate-local-qa.mjs'));
    writeFileSync(artifact,JSON.stringify({...prior,runnerHash:'0'.repeat(64)})); result=invoke(); assert.notEqual(result.status,0); assert.match(result.stderr,/Original revision does not match artifact runner fingerprint/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
