import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const image = process.argv[2] ?? "aurelle-demo:render-ready";
const name = `aurelle-smoke-${process.pid}`;
const expectedRevision = process.argv[3];
const run = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", timeout: 180000 }).trim();
let created = false;
try {
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
    "GROQ_BASE_URL=http://127.0.0.1:9/v1",
    image,
  );
  created = true;
  const port = run("port", name, "10000/tcp").split(":").at(-1);
  let base = `http://127.0.0.1:${port}`;
  let healthy = false;
  for (let i = 0; i < 120; i++) {
    try {
      const response = await fetch(`${base}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        const body = await response.json();
        assert.equal(body.status, "ok");
        assert.equal(body.embeddingProfile, "minilm");
        if (expectedRevision) assert.equal(body.revision, expectedRevision);
        healthy = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(healthy, "Container did not become healthy");
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await fetch(`${base}/products/mugs`)).status, 200);
  const imageResponse = await fetch(
    `${base}/_next/image?url=%2Fimages%2Fproducts%2Fmugs.webp&w=256&q=75`,
    { signal: AbortSignal.timeout(30000) },
  );
  assert.equal(imageResponse.status, 200, "Production image optimizer");
  assert.ok(imageResponse.headers.get("Content-Type")?.startsWith("image/"));
  async function search(label) {
    const start = performance.now();
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            id: label,
            role: "user",
            parts: [
              { type: "text", text: "I need something for my morning coffee" },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(100000),
    });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(body.includes("tool-output-available"));
    assert.ok(!body.includes('"type":"error"'));
    console.log(
      JSON.stringify({
        scenario: label,
        seconds: Math.round((performance.now() - start) / 100) / 10,
        memory: run("stats", "--no-stream", "--format", "{{.MemUsage}}", name),
      }),
    );
  }
  await search("baked-index");
  run(
    "exec",
    name,
    "node",
    "-e",
    "require('node:fs').rmSync('/app/.data/lancedb',{recursive:true,force:true})",
  );
  // A fresh process is needed to discard the old open Lance table handle.
  run("restart", name);
  base = `http://127.0.0.1:${run("port", name, "10000/tcp").split(":").at(-1)}`;
  for (let i = 0; i < 100; i++) {
    try {
      if (
        (
          await fetch(`${base}/api/health`, {
            signal: AbortSignal.timeout(3000),
          })
        ).ok
      )
        break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await search("rebuilt-index");
  assert.equal(
    run("inspect", "--format", "{{.State.OOMKilled}}", name),
    "false",
  );
  console.log(
    "[VERIFY] Docker smoke passed: 512 MiB, 0.1 CPU, real MiniLM/LanceDB; LLM transport is a deliberately offline fixture.",
  );
} catch (error) {
  if (created) process.stderr.write(run("logs", "--tail", "50", name) + "\n");
  throw error;
} finally {
  if (created) run("rm", "--force", name);
}
