// Use an isolated browser profile and synthetic customer conversations.
import { chromium } from '@playwright/test';
import { text, normalize, containsPolish, customerWritingChecks, customerSourceChecks, customerExternalChecks, customerAccountChecks, customerCheckoutChecks, customerChoiceChecks } from './agent-browser-quality.mjs';
import { open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const scenarios = ['help', 'coffee', 'garden', 'recall', 'facts', 'awareness', 'choice'];
const usage = `Usage: node scripts/agent-browser.mjs <store-origin> <new-private-output-path> [${scenarios.join('|')}|all]`;
const [baseArg, outputArg, requested = 'all', ...extra] = process.argv.slice(2);
if (!baseArg || !outputArg || extra.length || (requested !== 'all' && !scenarios.includes(requested))) throw new Error(usage);
const base = new URL(baseArg);
const publicRevision = process.env.AURELLE_PUBLIC_QA_REVISION;
if (publicRevision) {
  if (!/^[a-f0-9]{40}$/.test(publicRevision) || base.href !== 'https://ecommerce-agent.michalsalek.com/')
    throw new Error('Public acceptance needs the Aurelle demo origin and its full application revision.');
  const response = await fetch(new URL('/api/health', base), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(45_000) });
  if (!response.ok || (await response.json()).revision !== publicRevision)
    throw new Error('The public store has a different application revision.');
} else if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('Use an explicit HTTP 127.0.0.1 origin and port for local QA.');
}
const interval = Number(process.env.AGENT_BROWSER_INTERVAL_MS ?? (publicRevision ? 45_000 : 0));
if (!Number.isFinite(interval) || interval < 0) throw new Error('Invalid browser turn interval.');
let lastTurnStarted = 0;
if (!isAbsolute(outputArg)) throw new Error('Output must be an absolute path in the private temporary directory.');
const parent = await realpath(dirname(resolve(outputArg)));
const tempRoot = await realpath(tmpdir());
if (parent !== tempRoot && !parent.startsWith(tempRoot + '/')) throw new Error('Output must be inside the temporary directory.');
const output = join(parent, outputArg.split('/').at(-1));
// Exclusive creation avoids clobbering another run. Do not include headers or credentials.
const file = await open(output, 'wx', 0o600);
const report = { startedAt: new Date().toISOString(), base: base.origin, revision: publicRevision, scenario: requested, scenarios: [], failures: [], complete: false };
async function save() {
  const data = Buffer.from(JSON.stringify(report, null, 2) + '\n');
  await file.truncate(0);
  await file.write(data, 0, data.length, 0);
  await file.sync();
}
await save();
const TIMEOUT = 600_000;
const MAX_COOLDOWN = Number(process.env.AGENT_BROWSER_MAX_COOLDOWN_MS ?? (publicRevision ? 15 * 60_000 : 90_000));
if (!Number.isFinite(MAX_COOLDOWN) || MAX_COOLDOWN < 0) throw new Error("Invalid browser cooldown interval.");
const includesAll = (actual, expected) => expected.every(id => actual.includes(id));
const assertCheck = (target, label, pass, evidence) => {
  const check = { label, pass: Boolean(pass), ...(evidence === undefined ? {} : { evidence }) };
  target.checks.push(check);
  if (!check.pass) report.failures.push({ scenario: target.scenario, turn: target.number, check: label, evidence });
  return check.pass;
};
function eventsFrom(body) {
  const events = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;
    try { events.push(JSON.parse(raw)); } catch { events.push({ type: 'unparseable-event' }); }
  }
  return events;
}
function safeStatus(value) {
  if (!value || typeof value !== 'object') return value;
  const { status, code, retryAt, retryAfter, providerLimit, usage } = value;
  return { status, code, retryAt, retryAfter, providerLimit, usage };
}
function streamEvidence(events) {
  const first = type => events.find(event => event.type === `data-${type}`)?.data;
  const operation = first('operation');
  return {
    eventTypes: events.map(event => event.type),
    streamedText: events.filter(event => event.type === 'text-delta').map(event => text(event.delta)).join(''),
    assistantId: events.find(event => event.type === 'start')?.messageId,
    operation: operation?.error ? { ...operation, error: safeStatus(operation.error) } : operation, checkpoint: first('shoppingState'), products: first('products'),
    comparison: first('comparison'), advice: first('advice'), status: safeStatus(first('turnStatus')),
    streamError: events.some(event => event.type === 'error' || event.type === 'unparseable-event'),
  };
}
function safeRequest(request) {
  try {
    const body = request.postDataJSON();
    return {
      conversationId: body.conversationId, contract: body.contract,
      messages: Array.isArray(body.messages) ? body.messages.map(message => ({
        id: message.id, role: message.role,
        ...(message.role === 'user' ? { text: message.parts?.filter(part => part.type === 'text').map(part => part.text).join('\n'), action: message.metadata?.shoppingAction } : {}),
      })) : [],
    };
  } catch { return { invalid: true }; }
}
async function visibleSnapshot(page) {
  return page.evaluate(() => {
    const thread = document.querySelector('.chat-thread');
    const assistant = [...document.querySelectorAll('.chat-message.assistant')].at(-1);
    const cards = assistant ? [...assistant.querySelectorAll('.product.compact, .comparison-product')].map(card => {
      const link = card.querySelector('h3 a');
      const href = link?.getAttribute('href') ?? '';
      return { id: decodeURIComponent(href.split('/').filter(Boolean).at(-1) ?? ''), name: link?.textContent?.trim(), price: card.querySelector('strong')?.textContent?.trim(), text: card.innerText };
    }) : [];
    return {
      thread: thread?.innerText ?? '',
      assistant: assistant?.innerText ?? '',
      answer: assistant ? [...assistant.querySelectorAll(':scope > p')].map(p => p.innerText).join('\n') : '',
      cards,
      errors: [...document.querySelectorAll('.chat-error')].map(node => node.innerText),
    };
  });
}
async function capture(page, scenario, number, prompt) {
  const turn = { scenario, number, prompt, startedAt: new Date().toISOString(), checks: [], attempts: [] };
  report.scenarios.find(item => item.name === scenario).turns.push(turn);
  await save();
  const before = await page.locator('.chat-message.assistant').count();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const responsePromise = page.waitForResponse(response => response.url() === `${base.origin}/api/chat` && response.request().method() === 'POST', { timeout: TIMEOUT });
      if (!attempt) {
        const input = page.getByRole('textbox');
        await input.fill(prompt);
        await input.press('Enter');
      } else {
        await page.getByRole('button', { name: 'Retry last message' }).click();
      }
      const response = await responsePromise;
      const request = safeRequest(response.request());
      const result = { startedAt: new Date().toISOString(), request, httpStatus: response.status(), attemptId: response.headers()['x-request-id'] };
      turn.attempts.push(result);
      if (response.ok()) {
        await response.finished();
        const stream = (await response.body()).toString('utf8');
        const events = eventsFrom(stream);
        Object.assign(result, streamEvidence(events), { streamDone: /(?:^|\n)data:\s*\[DONE\]/.test(stream), finishEvent: events.some(event => event.type === 'finish') });
      } else {
        // Only whitelisted failure fields are persisted. Provider error bodies can contain secrets.
        const body = await response.json().catch(() => ({}));
        result.failure = { code: body?.code, retryAt: body?.retryAt, retryAfter: body?.retryAfter, retryAfterHeader: response.headers()['retry-after'] };
      }
      await page.waitForFunction(({ beforeCount }) => {
        const log = document.querySelector('.chat-thread');
        return log?.getAttribute('aria-busy') === 'false' && (document.querySelectorAll('.chat-message.assistant').length > beforeCount || Boolean(document.querySelector('.chat-error')));
      }, { beforeCount: before }, { timeout: TIMEOUT });
      result.visible = await visibleSnapshot(page);
      result.completedAt = new Date().toISOString();
      await save();
      const failure = result.status?.status === 'provider-limit' || response.status() === 429 || result.operation?.error?.status === 'provider-limit';
      if (!failure || attempt === 2) break;
      const retry = page.getByRole('button', { name: 'Retry last message' }).last();
      if (!await retry.count()) break;
      const cooldown = await page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('aurelle.chat.cooldown.v1') ?? 'null')?.status?.retryAt; } catch { return undefined; }
      });
      const fail = result.failure ?? result.status ?? result.operation?.error ?? {};
      const header = Number(fail.retryAfterHeader);
      const until = Math.max(Number(cooldown) || 0, Number(fail.retryAt) || 0, Date.now() + ((Number(fail.retryAfter) || header || 0) * 1000));
      if (until - Date.now() > MAX_COOLDOWN) { result.retryBoundary = `Cooldown exceeds the configured ${MAX_COOLDOWN / 1000} seconds.`; break; }
      // The UI owns its cooldown timer. Wait for its actual enabled state instead of sleeping.
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Retry last message' && !button.disabled), null, { timeout: MAX_COOLDOWN + 5000 });
    }
    const last = turn.attempts.at(-1);
    turn.request = last.request;
    turn.operation = last.operation;
    turn.checkpoint = last.checkpoint;
    turn.products = last.products;
    turn.comparison = last.comparison;
    turn.advice = last.advice;
    turn.status = last.status;
    turn.visible = last.visible;
    turn.userId = last.request?.messages?.findLast(message => message.role === 'user')?.id;
    turn.assistantId = last.assistantId;
    if (turn.attempts.length > 1) {
      const first = turn.attempts[0].request;
      assertCheck(turn, 'Retries retain the conversation and user IDs', turn.attempts.every(item => item.request?.conversationId === first?.conversationId && item.request?.messages?.findLast(message => message.role === 'user')?.id === first?.messages?.findLast(message => message.role === 'user')?.id));
    }
    assertCheck(turn, 'Request contains one synthetic user turn with an ID', Boolean(turn.userId && last.request.messages.at(-1)?.text === prompt && !last.request.messages.at(-1)?.action), { userId: turn.userId });
    assertCheck(turn, 'HTTP success and complete stream', last.httpStatus === 200 && !last.streamError && last.streamDone && last.finishEvent && last.status?.status === 'complete', { httpStatus: last.httpStatus, status: last.status?.status, streamError: last.streamError, streamDone: last.streamDone, finishEvent: last.finishEvent });
    assertCheck(turn, 'Operation and checkpoint are present', Boolean(turn.operation?.id && turn.checkpoint?.after), { operation: turn.operation?.kind, operationStatus: turn.operation?.status });
    assertCheck(turn, 'Operation completed', turn.operation?.status === 'completed', { status: turn.operation?.status });
    assertCheck(turn, 'Visible assistant response is present', Boolean(turn.visible?.answer?.trim()), { answer: turn.visible?.answer });
    assertCheck(turn, 'Assistant state retains Polish', turn.checkpoint?.after?.language === 'pl', { language: turn.checkpoint?.after?.language });
  } catch (error) {
    turn.error = String(error?.message ?? error).slice(0, 1000);
    turn.visible = await visibleSnapshot(page).catch(() => undefined);
    assertCheck(turn, 'Turn completed within the browser boundary', false, turn.error);
  }
  turn.completedAt = new Date().toISOString();
  await save();
  console.log(`[${scenario} ${number}] ${turn.checks.every(check => check.pass) ? 'captured' : 'protocol failure'}: ${turn.prompt}`);
  return turn;
}
function catalogCards(turn) { return turn.visible?.cards?.filter(card => card.id && card.name) ?? []; }
function checkPolish(turn) {
  assertCheck(turn, 'Visible response contains Polish language', containsPolish(turn.visible?.answer), { answer: turn.visible?.answer });
}
function comparisonChecks(turn, items) {
  const ids = items.map(item => item.id);
  const evidence = turn.comparison?.productIds ?? [];
  assertCheck(turn, 'Comparison uses the two requested product IDs', evidence.length === 2 && includesAll(evidence, ids), { expected: ids, actual: evidence });
  const cards = catalogCards(turn);
  assertCheck(turn, 'Both compared products have visible prices and availability', items.every(item => {
    const card = cards.find(candidate => candidate.id === item.id);
    const expectedStock = item.inStock ?? (item.text?.includes('Out of stock') ? false : item.text?.includes('Add to cart') ? true : undefined);
    return card && card.price === item.price && expectedStock !== undefined && card.text.includes(expectedStock ? 'In stock' : 'Out of stock');
  }), { expected: items, actual: cards });
}
const unconfirmed = /\b(?:brak|nieznan\w*|niedostep\w*|nie wiem|nie wiadomo|nie (?:ma|mam|podano|podaje|okreslono|znam|mozna|moge|potrafie)|katalog nie|nie zawiera|nie potwierdz\w*|brakuje|nie dysponuj\w*)\b/;
function missingFactCheck(turn) {
  const answer = normalize(turn.visible?.answer);
  assertCheck(turn, 'Unknown fact is explicitly unconfirmed', unconfirmed.test(answer), { answer: turn.visible?.answer });
  assertCheck(turn, 'Unknown temperature is not invented', !/\b\d+(?:[.,]\d+)?\s*(?:°\s*[cf]|stopni|celsjusz|fahrenheit)/i.test(answer), { answer: turn.visible?.answer });
}
async function runScenario(browser, name) {
  const scenario = { name, startedAt: new Date().toISOString(), turns: [] };
  report.scenarios.push(scenario);
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => {
    let allowed = false;
    try { allowed = new URL(route.request().url()).origin === base.origin; } catch { /* block invalid URLs */ }
    return allowed ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  try {
    await page.goto(`${base.origin}/chat`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.getByRole('textbox').waitFor({ state: 'visible', timeout: 30_000 });
    const ask = async prompt => {
      const delay = lastTurnStarted + interval - Date.now();
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      lastTurnStarted = Date.now();
      const turn = await capture(page, name, scenario.turns.length + 1, prompt);
      checkPolish(turn);
      await save();
      return turn;
    };
    if (name === 'help') {
      const help = await ask('Cześć, w czym możesz mi pomóc?');
      const paraphrase = await ask('Jakie sprawy zakupowe potrafisz dla mnie załatwić?');
      for (const turn of [help, paraphrase]) {
        const answer = normalize(turn.visible?.answer);
        assertCheck(turn, 'Help describes assistant capability in first person', /\b(?:moge|pomoge|pomagam|potrafie|znajde|pokaze|porownam|doradze|sprawdze)\b/.test(answer), { answer: turn.visible?.answer });
        assertCheck(turn, 'Help remains a capability answer rather than unsolicited product search', !turn.products?.products?.length && turn.operation?.kind !== 'search', { operation: turn.operation?.kind });
      }
      const product = await ask('Szukam ceramicznych kubków do kawy.');
      assertCheck(product, 'A contrasting shopping request produces product results', Boolean(product.products?.products?.length && catalogCards(product).length), { productIds: product.products?.products?.map(row => row.id) });
    } else if (name === 'awareness') {
      scenario.manualReview = [
        'Read every visible answer as a shopper: check fluent natural Polish, direct answers and no invented access or promises.',
        'Check that catalog and account boundaries are understandable without technical implementation details.',
      ];
      const check = (turn, checks) => checks.forEach(item => assertCheck(turn, item.label, item.pass, { answer: turn.visible?.answer }));
      const initialCart = await page.evaluate(() => localStorage.getItem('aurelle.cart.v1'));
      const source = await ask('Czy rozmawiam z obsługą tego sklepu? Skąd masz informacje o produktach i w czym możesz mi pomóc?');
      check(source, [...customerWritingChecks(source.visible?.answer), ...customerSourceChecks(source.visible?.answer)]);
      assertCheck(source, 'The capabilities question does not trigger an unsolicited product search', source.operation?.kind !== 'search' && !source.products?.products?.length, { operation: source.operation?.kind });
      const external = await ask('W innym sklepie znalazłem kubek Comet Brew 700. Czy możesz go tam sprawdzić i dodać do mojego koszyka tutaj?');
      check(external, [...customerWritingChecks(external.visible?.answer), ...customerExternalChecks(external.visible?.answer)]);
      const account = await ask('Czy widzisz moje konto i zamówienia z innych sklepów?');
      check(account, [...customerWritingChecks(account.visible?.answer), ...customerAccountChecks(account.visible?.answer)]);
      const checkout = await ask('Czy mogę tutaj naprawdę zapłacić i potem sprawdzić, gdzie jest moje zamówienie?');
      check(checkout, [...customerWritingChecks(checkout.visible?.answer), ...customerCheckoutChecks(checkout.visible?.answer)]);
      const finalCart = await page.evaluate(() => localStorage.getItem('aurelle.cart.v1'));
      const attempts = [source, external, account, checkout].flatMap(turn => turn.attempts);
      assertCheck(checkout, 'No external item or fictitious order changes the device cart', initialCart === finalCart && attempts.length > 0 && attempts.every(attempt => Array.isArray(attempt.eventTypes) && !attempt.eventTypes.includes('data-cartAction')), { cartUnchanged: initialCart === finalCart, cartActionEvents: attempts.filter(attempt => attempt.eventTypes?.includes('data-cartAction')).length });
    } else if (name === 'choice') {
      scenario.manualReview = [
        'Read the visible answer as a shopper: check fluent natural Polish and whether the stated reason genuinely supports the recommendation.',
        'Check that no unsupported product feature, heat rating, order or extra condition is presented as fact.',
      ];
      const choice = await ask('Chcę rano pić gorącą kawę. Zastanawiam się nad Ceramic mugs i Glass carafe. Który produkt będzie do tego lepszy i dlaczego?');
      for (const item of [...customerWritingChecks(choice.visible?.answer), ...customerChoiceChecks(choice.visible?.answer)])
        assertCheck(choice, item.label, item.pass, { answer: choice.visible?.answer });
      comparisonChecks(choice, [{ id: 'mugs', price: '€22.00', inStock: true }, { id: 'carafe', price: '€19.00', inStock: true }]);
      const cold = await ask('Zmiana planu. Wolę podawać cold brew. Który z tych dwóch produktów polecisz mi teraz?');
      comparisonChecks(cold, [{ id: 'mugs', price: '€22.00', inStock: true }, { id: 'carafe', price: '€19.00', inStock: true }]);
      const coldAnswer = normalize(cold.visible?.answer);
      assertCheck(cold, 'Changing preference recommends the carafe for serving cold brew', /polecam glass carafe/.test(coldAnswer) && /na zimno|cold brew/.test(coldAnswer), { answer: cold.visible?.answer });
      const boiling = await ask('Czy w tej karafce mogę bezpiecznie podawać wrzątek?');
      missingFactCheck(boiling);
      const back = await ask('Wróć do pierwszych kubków. Czy Ceramic mugs mają uchwyty?');
      const backAnswer = normalize(back.visible?.answer);
      assertCheck(back, 'Returning to the mugs confirms their documented handles', back.checkpoint?.presentedIds?.includes('mugs') && /uchwyt/.test(backAnswer) && !unconfirmed.test(backAnswer), { answer: back.visible?.answer });
    } else if (name === 'coffee') {
      const discovery = await ask('Szukam czegoś do porannej kawy.');
      assertCheck(discovery, 'Coffee discovery shows products', Boolean(discovery.products?.products?.length && catalogCards(discovery).length));
      const budget = await ask('Pokaż tylko produkty do 25 EUR.');
      const cards = catalogCards(budget);
      assertCheck(budget, 'Coffee budget is retained in the checkpoint', budget.checkpoint?.after?.criteria?.maxPrice === 25, { criteria: budget.checkpoint?.after?.criteria });
      assertCheck(budget, 'Every displayed product is within 25 EUR', cards.length > 0 && cards.every(card => Number(card.price?.replace(/[^0-9.,]/g, '').replace(',', '.')) <= 25), { cards });
      const comparison = await ask('Porównaj Ceramic mugs i Glass carafe.');
      const compared = catalogCards(comparison);
      comparisonChecks(comparison, [{ id: 'mugs', price: '€22.00', inStock: true }, { id: 'carafe', price: '€19.00', inStock: true }]);
      const switched = await ask('Zmieniłem zdanie, opowiedz więcej o Ceramic mugs.');
      assertCheck(switched, 'Changed selection is the earlier mugs product', includesAll(switched.products?.products?.map(row => row.id) ?? [], ['mugs']), { products: switched.products, checkpoint: switched.checkpoint?.after });
      const unknown = await ask('A teraz wróć do Glass carafe. Jaka jest maksymalna temperatura, którą wytrzymuje karafka?');
      assertCheck(unknown, 'Return targets the earlier carafe', [...(unknown.products?.products?.map(row => row.id) ?? []), ...(unknown.checkpoint?.after?.selectedIds ?? []), ...(unknown.checkpoint?.after?.lastIds ?? [])].includes('carafe'), { products: unknown.products, checkpoint: unknown.checkpoint?.after, previouslyCompared: compared });
      missingFactCheck(unknown);
    } else if (name === 'recall') {
      const comparison = await ask('Zestaw proszę Ceramic mugs z Glass carafe. Co kosztuje mniej?');
      comparisonChecks(comparison, [{ id: 'mugs', price: '€22.00', inStock: true }, { id: 'carafe', price: '€19.00', inStock: true }]);
      await ask('Jednak pokaż mi szczegóły pierwszego produktu z tego porównania.');
      const back = await ask('Wróćmy do drugiego produktu z tamtego porównania. Czy podano temperaturę, jaką wytrzymuje?');
      assertCheck(back, 'Ordinal refers to the carafe in the earlier comparison', (back.checkpoint?.presentedIds ?? []).includes('carafe'), { ids: back.checkpoint?.presentedIds });
      missingFactCheck(back);
    } else if (name === 'facts') {
      const pair = await ask('Porównaj Ceramic mugs i Glass carafe.');
      comparisonChecks(pair, [{ id: 'mugs', price: '€22.00', inStock: true }, { id: 'carafe', price: '€19.00', inStock: true }]);
      const price = await ask('Sprawdź cenę drugiego produktu z tego porównania.');
      assertCheck(price, 'An ordinal price request returns the carafe and its actual price in the answer',
        price.checkpoint?.presentedIds?.includes('carafe') && /19(?:[.,]00)?\s*EUR/i.test(price.visible?.answer ?? ''), { answer: price.visible?.answer });
      const unknown = await ask('Czy Glass carafe ma uchwyt?');
      assertCheck(unknown, 'The carafe handle is unconfirmed', unknown.checkpoint?.presentedIds?.includes('carafe') && unconfirmed.test(normalize(unknown.visible?.answer)), { answer: unknown.visible?.answer });
      const known = await ask('A czy Ceramic mugs mają uchwyty?');
      const answer = normalize(known.visible?.answer);
      assertCheck(known, 'The mugs have handles in the product record', known.checkpoint?.presentedIds?.includes('mugs') && /uchwyt/.test(answer) && !unconfirmed.test(answer) && !/\bbez uchwyt|nie maja\b/.test(answer), { answer: known.visible?.answer });
    } else {
      const search = await ask('Pokaż meble ogrodowe do 150 EUR.');
      assertCheck(search, 'Garden budget and outdoor scope are retained', search.checkpoint?.after?.criteria?.maxPrice === 150 && search.checkpoint?.after?.criteria?.useEnvironment === 'outdoor', { criteria: search.checkpoint?.after?.criteria });
      const seating = await ask('Szukam czegoś do siedzenia.');
      const choices = catalogCards(seating);
      assertCheck(seating, 'Seating offers at least two named products within budget', choices.length >= 2 && choices.every(card => Number(card.price?.replace(/[^0-9.,]/g, '').replace(',', '.')) <= 150), { choices });
      if (choices.length >= 2) {
        const selected = choices.slice(0, 2);
        const comparison = await ask(`Porównaj ${selected[0].name} i ${selected[1].name}.`);
        comparisonChecks(comparison, selected);
        const alternatives = await ask('Pokaż inne propozycje do siedzenia.');
        const alternativesIds = alternatives.products?.products?.map(row => row.id) ?? [];
        assertCheck(alternatives, 'Different options do not repeat the two compared products', alternativesIds.every(id => !selected.some(item => item.id === id)) && (alternativesIds.length > 0 || ['exhausted', 'no-match', 'unavailable'].includes(alternatives.products?.outcome)), { compared: selected.map(item => item.id), alternatives: alternativesIds, outcome: alternatives.products?.outcome });
        if (alternatives.products?.outcome === 'exhausted') {
          assertCheck(alternatives, 'An exhausted page explains that the shopper saw all matches without contradicting previous results', alternatives.advice?.status !== 'included' && /wszystkie|kolejnych/.test(normalize(alternatives.visible?.answer)), { answer: alternatives.visible?.answer });
          assertCheck(alternatives, 'An exhausted page does not offer advice about an empty selection', await page.getByRole('button', { name: 'Help me choose', exact: true }).count() === 0);
        }
        const back = await ask(`Jednak wróćmy do ${selected[0].name}. Powiedz mi więcej o tym produkcie.`);
        assertCheck(back, 'Return targets the originally selected product', (back.products?.products?.map(row => row.id) ?? []).includes(selected[0].id), { expected: selected[0].id, products: back.products, checkpoint: back.checkpoint?.after });
        const unknown = await ask(`Jaki jest maksymalny udźwig produktu ${selected[0].name}?`);
        const answer = normalize(unknown.visible?.answer);
        assertCheck(unknown, 'Unlisted load capacity is explicitly unconfirmed', unconfirmed.test(answer) && !/\b\d+(?:[.,]\d+)?\s*(?:kg|kilogram)/.test(answer), { answer: unknown.visible?.answer });
      } else {
        assertCheck(seating, 'Comparison branch has two products', false, { choices });
      }
    }
  } catch (error) {
    scenario.error = String(error?.message ?? error).slice(0, 1000);
    report.failures.push({ scenario: name, check: 'Scenario boundary', evidence: scenario.error });
  } finally {
    scenario.completedAt = new Date().toISOString();
    await save();
    await context.close();
  }
}
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-background-networking'] });
  for (const name of requested === 'all' ? scenarios : [requested]) await runScenario(browser, name);
  report.complete = true;
} catch (error) {
  report.failures.push({ check: 'Browser boundary', evidence: String(error?.message ?? error).slice(0, 1000) });
} finally {
  await browser?.close();
  report.completedAt = new Date().toISOString();
  await save();
  await file.close();
}
for (const failure of report.failures) console.log(`FAIL ${failure.scenario ?? 'driver'}${failure.turn ? ` ${failure.turn}` : ''}: ${failure.check}`);
console.log(`${report.complete && !report.failures.length ? 'PASS' : 'FAIL'}: ${report.scenarios.length} scenario(s), ${report.failures.length} failed check(s). Evidence: ${output}`);
if (report.scenarios.some(scenario => scenario.manualReview?.length)) console.log('Manual review is required for natural Polish, semantic directness and unsupported claims.');
if (!report.complete || report.failures.length) process.exitCode = 1;
