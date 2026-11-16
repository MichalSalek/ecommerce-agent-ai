import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const image = process.argv[2] ?? "aurelle-demo:render-ready";
const expectedRevision = process.argv[3];
const name = `aurelle-smoke-${process.pid}`;
const fixture = fileURLToPath(
  new URL("./native-model-fixture.mjs", import.meta.url),
);
const run = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", timeout: 180000 }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let created = false;
let maxPeak = 0;
function memoryPeak(phase) {
  // Verify the cgroup is the container's limited cgroup, not the host's root.
  const raw = run(
    "exec",
    name,
    "node",
    "-e",
    `const fs=require('node:fs');const p='/sys/fs/cgroup/';console.log(JSON.stringify({max:fs.readFileSync(p+'memory.max','utf8').trim(),peak:fs.readFileSync(p+'memory.peak','utf8').trim()}))`,
  );
  const { max, peak } = JSON.parse(raw);
  assert.equal(
    Number(max),
    512 * 1024 * 1024,
    "Cannot establish container cgroup memory limit",
  );
  assert.ok(
    Number.isFinite(Number(peak)) && Number(peak) > 0,
    "cgroup memory.peak unavailable",
  );
  maxPeak = Math.max(maxPeak, Number(peak));
  console.log(
    `[VERIFY] ${phase} cgroup peak ${(Number(peak) / 1048576).toFixed(1)} MiB`,
  );
  assert.ok(
    Number(peak) < 400 * 1024 * 1024,
    `${phase}: memory peak must be below 400 MiB`,
  );
}
async function healthy(base, phase, requireManifest = true) {
  for (let i = 0; i < 240; i++) {
    try {
      const response = await fetch(`${base}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        const body = await response.json();
        assert.equal(body.status, "ok");
        assert.equal(body.service, "aurelle");
        assert.equal(body.embeddingProfile, "minilm");
        assert.equal(body.productCount, 86);
        if (requireManifest) {
          assert.equal(body.preparedIndex?.productCount, 86);
          assert.equal(body.preparedIndex?.fingerprint, body.indexFingerprint);
        }
        assert.ok(body.revision, "Revision missing");
        if (expectedRevision) assert.equal(body.revision, expectedRevision);
        return body;
      }
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
    }
    await sleep(500);
  }
  throw new Error(`${phase}: container did not become healthy`);
}
function parseSSE(raw) {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)));
}
async function search(base, phase, semanticCoffee = false) {
  const started = performance.now();
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contract: "shopping-v3",
      conversationId: crypto.randomUUID(),
      messages: [
        {
          id: crypto.randomUUID(),
          role: "user",
          parts: [
            {
              type: "text",
              text: semanticCoffee
                ? "[fixture-semantic-coffee] Find products for my morning coffee"
                : "Show me ten products",
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(180000),
  });
  assert.equal(response.status, 200, `${phase}: API status`);
  const events = parseSSE(await response.text());
  assert.ok(
    !events.some((event) => event.type === "error"),
    `${phase}: stream error`,
  );
  assert.equal(
    events.find((event) => event.type === "data-turnStatus")?.data.status,
    "complete",
    `${phase}: incomplete turn`,
  );
  const result = events.find((event) => event.type === "data-products")?.data;
  assert.ok(
    result && Array.isArray(result.products),
    `${phase}: missing result`,
  );
  const count = result.products.length;
  assert.equal(new Set(result.products.map((item) => item.id)).size, count);
  if (semanticCoffee) {
    assert.equal(
      result.appliedCriteria.query,
      "morning coffee",
      `${phase}: semantic query missing`,
    );
    assert.deepEqual(result.appliedCriteria.productTypes, [
      "mug",
      "carafe",
      "coffee-dripper",
      "coffee-grinder",
      "kettle",
      "scale",
    ]);
    assert.ok(count >= 1 && count <= 10, `${phase}: expected 1 to 10 cards`);
    const coffeeIds = new Set([
      "mugs",
      "carafe",
      "travel-mug",
      "pour-over-dripper",
      "coffee-grinder",
      "digital-coffee-scale",
      "gooseneck-kettle",
    ]);
    assert.ok(
      result.products.some((item) => coffeeIds.has(item.id)),
      `${phase}: no known coffee product`,
    );
    for (const field of [
      "scopeTotal",
      "totalMatches",
      "unseenMatches",
      "remainingMatches",
    ])
      assert.ok(
        Number.isInteger(result[field]) && result[field] >= 0,
        `${phase}: invalid ${field}`,
      );
    assert.ok(
      result.totalMatches <= result.scopeTotal &&
        result.unseenMatches <= result.totalMatches,
      `${phase}: invalid counts`,
    );
    assert.equal(
      result.remainingMatches,
      result.unseenMatches - (result.newlyShownCount ?? count),
      `${phase}: invalid remaining count`,
    );
  } else {
    assert.equal(count, 10, `${phase}: ten cards`);
    assert.equal(result.totalMatches, 86, `${phase}: canonical catalog size`);
    assert.equal(result.remainingMatches, 76);
  }
  assert.ok(events.some((event) => event.type === "data-shoppingState"));
  console.log(
    `[VERIFY] ${phase} finished in ${((performance.now() - started) / 1000).toFixed(1)}s`,
  );
}
try {
  // Wait for docker cp before launching the app and the fixture in the same container network namespace.
  run(
    "run",
    "--detach",
    "--name",
    name,
    "--memory=512m",
    "--memory-swap=512m",
    "--cpus=0.1",
    "--publish",
    "127.0.0.1::10000",
    "--env",
    "CHAT_PROVIDER=groq",
    "--env",
    "GROQ_API_KEY=fixture",
    "--env",
    "GROQ_BASE_URL=http://127.0.0.1:9999/v1",
    "--entrypoint",
    "sh",
    image,
    "-c",
    "while [ ! -f /tmp/native-model-fixture.mjs ]; do sleep 1; done; node /tmp/native-model-fixture.mjs & exec node server.js",
  );
  created = true;
  run("cp", fixture, `${name}:/tmp/native-model-fixture.mjs`);
  let base = `http://127.0.0.1:${run("port", name, "10000/tcp").split(":").at(-1)}`;
  const first = await healthy(base, "cold boot");
  for (const path of [
    "/",
    "/chat",
    "/products/mugs",
    "/images/products/folding-garden-chair.webp",
  ]) {
    const response = await fetch(base + path, {
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 200, path);
    if (path.endsWith(".webp"))
      assert.ok(response.headers.get("content-type")?.startsWith("image/"));
  }
  await Promise.all([
    search(base, "cold structural ten cards"),
    search(base, "cold semantic coffee", true),
  ]);
  memoryPeak("cold concurrent requests");
  run(
    "exec",
    name,
    "node",
    "-e",
    "require('node:fs').rmSync('/app/.data/lancedb',{recursive:true,force:true})",
  );
  run("restart", name);
  base = `http://127.0.0.1:${run("port", name, "10000/tcp").split(":").at(-1)}`;
  // Liveness does not require a prepared index; the first search performs the rebuild.
  let listening = false;
  for (let i = 0; i < 240; i++) {
    try {
      if (
        (
          await fetch(`${base}/api/health`, {
            signal: AbortSignal.timeout(3000),
          })
        ).ok
      ) {
        listening = true;
        break;
      }
    } catch {}
    await sleep(500);
  }
  assert.ok(listening, "Restarted server did not become live");
  await search(base, "missing index rebuild");
  const rebuilt = await healthy(base, "rebuilt index", false);
  assert.equal(rebuilt.indexFingerprint, first.indexFingerprint);
  assert.equal(rebuilt.revision, first.revision);
  assert.equal(
    run(
      "exec",
      name,
      "node",
      "-e",
      "const fs=require('node:fs');process.stdout.write(String(fs.existsSync('/app/.data/lancedb/products_'+process.argv[1]+'.lance')))",
      rebuilt.indexFingerprint,
    ),
    "true",
    "Rebuilt content-addressed table is missing",
  );
  memoryPeak("index rebuild");
  assert.equal(
    run("inspect", "--format", "{{.State.OOMKilled}}", name),
    "false",
    "Container was OOM-killed",
  );
  console.log(
    `[VERIFY] Docker smoke passed; peak ${(maxPeak / 1048576).toFixed(1)} MiB, 512 MiB limit, 0.1 CPU. Native tool fixture is not real-model acceptance.`,
  );
} catch (error) {
  if (created) {
    try {
      process.stderr.write(run("logs", "--tail", "50", name) + "\n");
    } catch {}
  }
  throw error;
} finally {
  if (created) run("rm", "--force", name);
}
