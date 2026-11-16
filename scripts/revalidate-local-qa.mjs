// Revalidate one known garden assertion against the unchanged catalog and evidence.
// This module is also imported by the local runner; it never calls a provider.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile, link, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ORIGINAL_REVISION='13c02c7f019b42b660cf009d8ff65c4df612b887';
const OLD_ERROR="Expected values to be strictly equal:\n+ actual - expected\n\n+ undefined\n- 'furniture'\n";
const expectedPrompts={
  en:['Show me garden furniture under EUR 150','I need something to sit on'],
  pl:['Pokaż meble ogrodowe do 150 EUR','Szukam czegoś do siedzenia'],
};
const sameSet=(a,b)=>a.length===b.length && new Set(a).size===a.length && a.every(value=>b.includes(value));
export function validateGardenTurn(turn, index, products, productTypes, functionalGroups) {
  const c=turn?.checkpoint?.after?.criteria;
  assert.ok(c && typeof c==='object','Missing garden criteria');
  assert.equal(c.maxPrice,150,'Garden budget must remain 150');
  assert.equal(c.useEnvironment,'outdoor','Garden outdoor condition missing');
  const sources=[];
  if(c.productType!==undefined) sources.push([c.productType]);
  if(c.productTypes!==undefined) {assert.ok(Array.isArray(c.productTypes) && c.productTypes.length>0,'Empty or invalid product types'); sources.push(c.productTypes);}
  if(c.functionalGroup!==undefined) {const types=functionalGroups[c.functionalGroup]?.types; assert.ok(Array.isArray(types) && types.length>0,'Unknown or empty functional group'); sources.push(types);}
  if(c.productKind!==undefined) assert.equal(c.productKind,'furniture','Wrong explicit product kind');
  else assert.ok(sources.length>0,'Garden kind is not constrained');
  for(const types of sources) for(const type of types) assert.equal(productTypes[type]?.kind,'furniture',`Unknown or non-furniture canonical type: ${type}`);
  const rows=turn.result?.products;
  assert.ok(Array.isArray(rows) && rows.length>0 && rows.length<=10 && new Set(rows.map(row=>row.id)).size===rows.length,'Invalid garden product rows');
  for(const row of rows) {
    const product=products.get(row.id);
    assert.ok(product && product.productKind==='furniture' && productTypes[product.productType]?.kind==='furniture','Garden row is not canonical furniture');
    assert.ok(['outdoor','both'].includes(product.useEnvironment),'Garden row is not outdoor');
    assert.ok(product.currency==='EUR' && typeof product.price==='number' && product.price>=0 && product.price<=150,'Garden row exceeds budget');
  }
  if(index===1) {
    const seating=functionalGroups.seating?.types;
    assert.ok(Array.isArray(seating) && sameSet(seating,['chair','bench','lounger','sofa','stool']),'Seating taxonomy is not the complete canonical set');
    const explicit=[...(c.productTypes ?? []),...(c.productType!==undefined?[c.productType]:[])];
    assert.ok(c.functionalGroup==='seating' || sameSet(explicit,seating),'Refinement lacks the complete seating group');
    assert.ok(rows.every(row=>seating.includes(products.get(row.id)?.productType)),'Refinement includes non-seating rows');
  }
}
export function validateGardenConversation(batch, language, products, productTypes, functionalGroups) {
  assert.ok(expectedPrompts[language] && Array.isArray(batch.turns) && batch.turns.length===2,'Garden conversation requires exactly two turns');
  for(const [index,turn] of batch.turns.entries()) {
    assert.equal(turn.text,expectedPrompts[language][index],'Garden prompt mismatch');
    assert.equal(turn.httpStatus,200,'Garden HTTP request failed');
    assert.equal(turn.validated,true,'Garden turn did not pass protocol validation');
    assert.equal(turn.operation?.status,'completed','Garden operation not completed');
    assert.equal(turn.operation?.kind,'search','Garden operation is not a search');
    assert.equal(turn.checkpoint?.after?.language,language,'Garden response language mismatch');
    validateGardenTurn(turn,index,products,productTypes,functionalGroups);
  }
  assert.deepEqual(batch.turns[1].checkpoint.before,batch.turns[0].checkpoint.after,'Garden refinement lost its preceding state');
}
export function revalidateGarden(report, products, productTypes, functionalGroups, sourceArtifact, proof) {
  assert.ok(Array.isArray(report.batches) && Array.isArray(report.failures),'Invalid report');
  for(const [name,language] of [['garden-en','en'],['garden-pl','pl']]) {
    const rows=report.batches.filter(batch=>batch.name===name);
    assert.equal(rows.length,1,`Expected one ${name} batch`);
    if(rows[0].passed===true) validateGardenConversation(rows[0],language,products,productTypes,functionalGroups);
  }
  const garden=report.batches.find(batch=>batch.name==='garden-pl');
  assert.equal(garden.passed,false,'Only the known failed Polish garden batch can be promoted');
  assert.equal(garden.error,OLD_ERROR,'Garden failure does not match the original kind assertion');
  validateGardenConversation(garden,'pl',products,productTypes,functionalGroups);
  assert.equal(report.failures.filter(failure=>failure.name==='garden-pl' && failure.error===OLD_ERROR).length,1,'Original failure entry missing or duplicated');
  const result=structuredClone(report), promoted=result.batches.find(batch=>batch.name==='garden-pl');
  promoted.passed=true;
  promoted.originalError=promoted.error;
  delete promoted.error;
  promoted.revalidatedFrom={artifact:sourceArtifact,sourceRevision:ORIGINAL_REVISION};
  promoted.revalidationProof={...proof,validator:'garden-effective-furniture-v1',checkedTurns:2,checkedAt:new Date().toISOString()};
  result.failures=result.failures.filter(failure=>!(failure.name==='garden-pl' && failure.error===OLD_ERROR));
  return result;
}
async function main() {
  const {values}=parseArgs({options:{input:{type:'string'},output:{type:'string'},inspect:{type:'string'},help:{type:'boolean'}}});
  if(values.help) {console.log('Usage: node scripts/revalidate-local-qa.mjs --inspect /tmp/input.json\n       node scripts/revalidate-local-qa.mjs --input /tmp/finished.json --output /tmp/new.json\nOnly the known Polish garden representation assertion is eligible; no model calls.'); return;}
  assert.ok(Boolean(values.inspect)!==Boolean(values.input),'Choose --inspect or --input');
  assert.ok(values.inspect ? !values.output : Boolean(values.output),'Write mode requires --output; inspect is read-only');
  const privatePath=value=>{const path=resolve(value);assert.ok(path.startsWith(resolve(tmpdir())+'/'),'Artifact must be in the private temporary directory');return path;};
  const input=privatePath(values.inspect ?? values.input), output=values.output && privatePath(values.output);
  assert.notEqual(input,output,'Output must differ from the original');
  const report=JSON.parse(await readFile(input,'utf8'));
  if(!values.inspect) assert.ok(typeof report.finished==='string' && !Number.isNaN(Date.parse(report.finished)),'The original run must be finished before writing');
  assert.equal(report.execution,'engine-functional-QA');
  assert.equal(report.model,'qwen38-uncensored');
  assert.equal(report.profile?.reasoningDisabled,true,'Original profile is not verified');
  assert.equal(report.profile?.probe,'content-without-reasoning-v1');
  const root=fileURLToPath(new URL('../',import.meta.url));
  async function files(dir) {const paths=[];for(const e of (await readdir(join(root,dir),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=`${dir}/${e.name}`;if(e.isDirectory()) paths.push(...await files(path));else if(e.isFile())paths.push(path);}return paths;}
  async function hash(paths,get) {const h=createHash('sha256');for(const path of paths){const data=await get(path);h.update(`${path.length}:${path}:${data.length}:`);h.update(data);}return h.digest('hex');}
  const sourcePaths=await files('src');
  const sourceFingerprint=await hash([...sourcePaths,'package-lock.json'],path=>readFile(join(root,path)));
  assert.equal(report.fingerprint,sourceFingerprint,'Application source fingerprint differs');
  const runnerHash=await hash(['scripts/agent-local.mjs','scripts/agent-local-core.ts'],path=>execFileSync('git',['show',`${ORIGINAL_REVISION}:${path}`],{cwd:root}));
  assert.equal(report.runnerHash,runnerHash,'Original runner revision does not match the artifact');
  const data=JSON.parse(execFileSync(join(root,'node_modules/.bin/tsx'),['-e','import {products} from "./src/data/products"; import {functionalGroups} from "./src/domain/catalog/functional-groups"; import {productTypes} from "./src/domain/catalog/taxonomy"; console.log(JSON.stringify({products,functionalGroups,productTypes}))'],{cwd:root,encoding:'utf8'}));
  const proof={sourceFingerprint,originalRunnerHash:runnerHash,originalRevision:ORIGINAL_REVISION};
  const revised=revalidateGarden(report,new Map(data.products.map(product=>[product.id,product])),data.productTypes,data.functionalGroups,input,proof);
  assert.deepEqual(await files('src'),sourcePaths,'Application source paths changed during revalidation');
  assert.equal(await hash([...sourcePaths,'package-lock.json'],path=>readFile(join(root,path))),sourceFingerprint,'Application source changed during revalidation');
  if(values.inspect) {console.log(JSON.stringify({eligible:true,readOnly:true,originalFinished:Boolean(report.finished),remainingFailures:revised.failures.map(failure=>failure.name),proof}));return;}
  const temporary=`${output}.${randomUUID()}.tmp`;
  try {await writeFile(temporary,JSON.stringify(revised,null,2),{mode:0o600,flag:'wx'});await link(temporary,output);} finally {await unlink(temporary).catch(()=>{});}
  console.log(JSON.stringify({output,promoted:'garden-pl',remainingFailures:revised.failures.map(failure=>failure.name),proof}));
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) await main();
