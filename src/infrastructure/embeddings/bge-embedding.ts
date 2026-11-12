import type { TextEmbedding } from "@/application/catalog/text-embedding";
import { pipeline } from "@huggingface/transformers";
import { resolve } from "node:path";

const REVISION = "ea104dacec62c0de699686887e3f920caeb4f3e3";
const MODEL = "Xenova/bge-small-en-v1.5";
export class BgeEmbedding implements TextEmbedding {
  readonly identity = `${MODEL}@${REVISION}:q8:cls:normalized:v1`;
  readonly dimensions = 384;
  private extractor?: ReturnType<typeof this.load>;
  constructor(private readonly cacheDirectory: string) {}
  private load() {
    console.log("[EMBEDDING] loading BGE small on CPU");
    return pipeline("feature-extraction", MODEL, {
      dtype: "q8",
      cache_dir: resolve(this.cacheDirectory),
      revision: REVISION,
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
    const result = await extractor(texts, { pooling: "cls", normalize: true });
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
    const [vector] = await this.embed([
      `Represent this sentence for searching relevant passages: ${text}`,
    ]);
    return vector;
  }
}
