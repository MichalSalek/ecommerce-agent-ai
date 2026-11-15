export const embeddingProfiles = {
  bge: {
    model: "Xenova/bge-small-en-v1.5",
    revision: "ea104dacec62c0de699686887e3f920caeb4f3e3",
    pooling: "cls" as const,
    maxDistance: 0.45,
    prefix: "Represent this sentence for searching relevant passages: ",
  },
  minilm: {
    model: "Xenova/all-MiniLM-L6-v2",
    revision: "751bff37182d3f1213fa05d7196b954e230abad9",
    pooling: "mean" as const,
    maxDistance: 0.74,
    prefix: "",
  },
};
export type EmbeddingProfile = keyof typeof embeddingProfiles;

export function embeddingIdentity(profile: EmbeddingProfile) {
  const p = embeddingProfiles[profile];
  return `${p.model}@${p.revision}:q8:${p.pooling}:normalized:v1`;
}
