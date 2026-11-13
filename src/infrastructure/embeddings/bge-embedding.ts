import { TransformerEmbedding } from "./transformer-embedding";
export class BgeEmbedding extends TransformerEmbedding {
  constructor(cacheDirectory: string) {
    super(cacheDirectory, "bge");
  }
}
