import type { TextEmbedding } from "@/application/catalog/text-embedding";
import {
  AutoModel,
  BertTokenizer,
  FeatureExtractionPipeline,
  env,
} from "@huggingface/transformers";
import { resolve, dirname } from "node:path";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
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
  private async load() {
    console.log("[EMBEDDING] loading on CPU:", this.profile.model);
    const options = {
      dtype: "q8" as const,
      cache_dir: resolve(this.cacheDirectory),
      revision: this.profile.revision,
      device: "cpu" as const,
      session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
    };
    // v4 pipeline metadata detection does not forward cache/revision options.
    // Load both known text components explicitly so offline startup uses pinned files.
    const tokenizerFile = async (file: string) => {
      const path = resolve(
        this.cacheDirectory,
        this.profile.model,
        this.profile.revision,
        file,
      );
      try {
        return JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        if (
          !(
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ENOENT"
          )
        )
          throw error;
      }
      if (!env.allowRemoteModels)
        throw new Error(`Missing pinned tokenizer file: ${file}`);
      const response = await fetch(
        `https://huggingface.co/${this.profile.model}/resolve/${this.profile.revision}/${file}`,
        { signal: AbortSignal.timeout(60000) },
      );
      if (!response.ok)
        throw new Error(`Tokenizer download failed (${response.status}).`);
      const content = await response.text();
      const json = JSON.parse(content);
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${crypto.randomUUID()}.tmp`;
      await writeFile(temporary, content);
      await rename(temporary, path);
      return json;
    };
    const [tokenizerJSON, tokenizerConfig, model] = await Promise.all([
      tokenizerFile("tokenizer.json"),
      tokenizerFile("tokenizer_config.json"),
      AutoModel.from_pretrained(this.profile.model, options),
    ]);
    const tokenizer = new BertTokenizer(tokenizerJSON, tokenizerConfig);
    return new FeatureExtractionPipeline({
      task: "feature-extraction",
      tokenizer,
      model,
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
