// Shared by the server composition and the release canary.
/** @type {Readonly<{provider: "groq", modelId: string, baseURL: string}>} */
export const GROQ_IDENTITY = Object.freeze({
  provider: "groq",
  modelId: "openai/gpt-oss-120b",
  baseURL: "https://api.groq.com/openai/v1",
});
