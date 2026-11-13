import { readdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
const root = resolve(process.argv[2] ?? ".next/standalone");
if (!root.includes(".next/standalone"))
  throw new Error("Only generated standalone output may be pruned.");
let removed = 0;
async function prune(directory) {
  for (const version of await readdir(join(directory, "bin"), {
    withFileTypes: true,
  }).catch(() => [])) {
    if (!version.isDirectory() || !version.name.startsWith("napi-v")) continue;
    const base = join(directory, "bin", version.name);
    for (const platform of await readdir(base, { withFileTypes: true })) {
      if (!platform.isDirectory()) continue;
      if (platform.name !== process.platform) {
        await rm(join(base, platform.name), { recursive: true, force: true });
        removed++;
        continue;
      }
      for (const arch of await readdir(join(base, platform.name), {
        withFileTypes: true,
      })) {
        if (!arch.isDirectory()) continue;
        const path = join(base, platform.name, arch.name);
        if (arch.name !== process.arch) {
          await rm(path, { recursive: true, force: true });
          removed++;
          continue;
        }
        for (const file of await readdir(path))
          if (/providers_(cuda|tensorrt)/.test(file)) {
            await rm(join(path, file), { force: true });
            removed++;
          }
      }
    }
  }
}
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(directory, entry.name);
    if (entry.name === "onnxruntime-node") await prune(path);
    else await visit(path);
  }
}
await visit(root);
console.log(
  `[BUILD] removed ${removed} unused platform/GPU runtime entries; target is ${process.platform}/${process.arch} CPU.`,
);
