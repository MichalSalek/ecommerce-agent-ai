import { products } from "@/data/products";
import { CatalogService } from "@/application/catalog/catalog-service";
import {
  TransformerEmbedding,
  embeddingProfiles,
} from "@/infrastructure/embeddings/transformer-embedding";
import { z } from "zod";
import { LanceProductRepository } from "@/infrastructure/catalog/lance-product-repository";
// Only this composition root chooses concrete adapters and reads deployment settings.
export function createShop() {
  const profile = z
    .enum(["bge", "minilm"])
    .parse(process.env.EMBEDDING_MODEL ?? "bge");
  const embedding = new TransformerEmbedding(
    process.env.EMBEDDING_CACHE_DIR ?? ".data/models",
    profile,
  );
  const repository = new LanceProductRepository(
    process.env.LANCEDB_DIR ?? ".data/lancedb",
    embedding,
    products,
    embeddingProfiles[profile].maxDistance,
  );
  const catalog = new CatalogService(repository);
  return {
    repository,
    catalog,
  };
}
let shop: ReturnType<typeof createShop> | undefined;
export function getShop() {
  return (shop ??= createShop());
}
