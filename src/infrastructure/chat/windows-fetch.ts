import { spawn } from "node:child_process";
// Explicit WSL transport: curl runs in Windows, where the loopback-only balancer lives.
export const windowsFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.protocol !== "http:"
  )
    throw new Error("Windows transport only accepts local HTTP endpoints.");
  if (typeof init?.body !== "string")
    throw new Error("Expected a JSON request body.");
  return new Promise<Response>((resolve, reject) => {
    const args = [
      "--silent",
      "--show-error",
      "--max-time",
      "80",
      "--request",
      init.method ?? "POST",
      url,
      "--data-binary",
      "@-",
      "--write-out",
      "\n%{http_code}",
    ];
    new Headers(init.headers).forEach((value, key) =>
      args.push("--header", `${key}: ${value}`),
    );
    const child = spawn("/mnt/c/Windows/System32/curl.exe", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let finished = false;
    const signal = init.signal;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      child.kill();
      reject(error);
    };
    const abort = () => fail(new Error("Balancer request cancelled."));
    const timer = setTimeout(
      () => fail(new Error("Balancer request timed out.")),
      85000,
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 2000000)
        fail(new Error("Balancer response too large."));
    });
    child.stderr.resume();
    child.stdin.on("error", () => undefined);
    child.on("error", () =>
      fail(new Error("Windows curl transport is unavailable.")),
    );
    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (code !== 0) {
        reject(new Error("Cannot reach the Windows Groq balancer."));
        return;
      }
      const cut = output.lastIndexOf("\n");
      const status = Number(output.slice(cut + 1).trim());
      if (status < 100 || status > 599) {
        reject(new Error("Invalid balancer HTTP response."));
        return;
      }
      resolve(
        new Response(output.slice(0, cut), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    child.stdin.end(init.body);
  });
};
