import assert from 'node:assert/strict';
const base = new URL(process.argv[2] || 'https://ecommerce-agent.michalsalek.com');
const assets = new Set();
for (const path of ['/', '/chat', '/cart', '/products/mugs']) {
  const response = await fetch(new URL(path, base), { headers: { Accept: 'text/html', 'Accept-Encoding': 'gzip, br' }, signal: AbortSignal.timeout(90000) });
  assert.equal(response.status, 200, path);
  const html = await response.text();
  assert.ok(html.includes('Aurelle') && html.includes('/_next/static/'), `Incomplete application document: ${path}`);
  for (const match of html.matchAll(/(?:src|href)="([^"<>]+)"/g)) {
    const url = new URL(match[1].replaceAll('&amp;', '&'), base);
    if (url.origin === base.origin && (url.pathname.startsWith('/images/') || url.pathname.startsWith('/_next/static/'))) assets.add(url.href);
  }
}
const pending = [...assets];
await Promise.all([0, 1].map(async () => {
  while (pending.length) {
    const url = pending.pop();
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, url);
    const contentType = response.headers.get('content-type') || '';
    assert.ok(!contentType.includes('text/html'), `An asset returned an HTML loading page: ${url}`);
    await response.arrayBuffer();
  }
}));
console.log(`Verified and warmed four application documents and ${assets.size} assets at ${base.origin}.`);
