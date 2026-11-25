import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { GROQ_IDENTITY } from "@/infrastructure/chat/groq-identity.mjs";

// QA is enabled only by an explicit server setting and a loopback-bound server.
// Render always rejects it, even when a production build is reused locally.
export function chatConfig(env: Record<string, string | undefined> = process.env) {
  const qa = env.AURELLE_LOCAL_QA;
  const render = ["RENDER", "RENDER_SERVICE_ID", "RENDER_EXTERNAL_URL"]
    .some((key) => env[key] !== undefined);
  if (qa) {
    if (
      render || env.HOSTNAME !== "127.0.0.1"
    )
      throw new Error("Local QA requires loopback binding and is unavailable on Render.");
    if (qa !== "llama" && qa !== "groq-proxy")
      throw new Error("Unknown local QA mode.");
    const raw = qa === "llama" ? env.LLAMA_BASE_URL : env.GROQ_BASE_URL;
    let url: URL;
    try {
      url = new URL(raw ?? "");
    } catch {
      throw new Error("Local QA requires a loopback provider URL.");
    }
    if (
      url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port ||
      url.username || url.password || url.search || url.hash
    )
      throw new Error("Local QA requires a loopback provider URL.");
    if (qa === "llama") {
      if (!env.LLAMA_MODEL) throw new Error("Local QA requires LLAMA_MODEL.");
      return {
        provider: "llama" as const,
        baseURL: url.href.replace(/\/$/, ""),
        modelId: env.LLAMA_MODEL,
      };
    }
    return {
      provider: GROQ_IDENTITY.provider,
      groq: { baseURL: url.href.replace(/\/$/, ""), modelId: GROQ_IDENTITY.modelId, apiKey: env.GROQ_API_KEY },
    };
  }
  const apiKey = env.GROQ_API_KEY || (!render && env.AURELLE_GROQ_KEY_FILE
    ? parseEnv(readFileSync(env.AURELLE_GROQ_KEY_FILE, "utf8")).API_KEY
    : undefined);
  return { provider: GROQ_IDENTITY.provider, groq: { baseURL: GROQ_IDENTITY.baseURL, modelId: GROQ_IDENTITY.modelId, apiKey } };
}
