import type { TextEmbedding } from "@/application/catalog/text-embedding";
import { pipeline } from "@huggingface/transformers";
import { resolve } from "node:path";
import {
  embeddingProfiles,
  embeddingIdentity,
  type EmbeddingProfile,
} from "./profiles";
export { embeddingProfiles, type EmbeddingProfile } from "./profiles";
export class TransformerEmbedding implements TextEmbedding {
  readonly dimensions = 384;
  readonly identity: string;
  private extractor?: ReturnType<typeof this.load>;
  private profile: (typeof embeddingProfiles)[EmbeddingProfile];
  constructor(
    private readonly cacheDirectory: string,
    profile: EmbeddingProfile = "bge",
  ) {
    this.profile = embeddingProfiles[profile];
    if (!this.profile)
      throw new Error("Unknown embedding profile. Use bge or minilm.");
    this.identity = embeddingIdentity(profile);
  }
  private load() {
    console.log("[EMBEDDING] loading on CPU:", this.profile.model);
    return pipeline("feature-extraction", this.profile.model, {
      dtype: "q8",
      cache_dir: resolve(this.cacheDirectory),
      revision: this.profile.revision,
      device: "cpu",
      session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
    });
  }
  private async embed(texts: string[]): Promise<number[][]> {
    this.extractor ??= this.load().catch((error) => {
      this.extractor = undefined;
      throw error;
    });
    const extractor = await this.extractor;
    const result = await extractor(texts, {
      pooling: this.profile.pooling,
      normalize: true,
    });
    const rows: number[][] = result.tolist();
    if (
      rows.some(
        (row) =>
          row.length !== this.dimensions ||
          row.some((n) => !Number.isFinite(n)),
      )
    )
      throw new Error("Invalid embedding dimensions or values.");
    return rows;
  }
  embedDocuments(texts: string[]) {
    return this.embed(texts);
  }
  async embedQuery(text: string) {
    const [vector] = await this.embed([this.profile.prefix + text]);
    return vector;
  }
}
