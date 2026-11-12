import { products } from "@/data/products";
import { CatalogService } from "@/application/catalog/catalog-service";
import { createShopTools } from "@/application/chat/tools";
import { BgeEmbedding } from "@/infrastructure/embeddings/bge-embedding";
import { LanceProductRepository } from "@/infrastructure/catalog/lance-product-repository";
// Only this composition root chooses concrete adapters and reads deployment settings.
export function createShop() {
  const embedding = new BgeEmbedding(
    process.env.EMBEDDING_CACHE_DIR ?? ".data/models",
  );
  const repository = new LanceProductRepository(
    process.env.LANCEDB_DIR ?? ".data/lancedb",
    embedding,
    products,
  );
  return { repository, tools: createShopTools(new CatalogService(repository)) };
}
let shop: ReturnType<typeof createShop> | undefined;
export function getShop() {
  return (shop ??= createShop());
}
export function chatConfig() {
  return {
    baseURL: process.env.LLAMA_BASE_URL ?? "http://127.0.0.1:8080/v1",
    modelId: process.env.LLAMA_MODEL,
    mode: process.env.LLAMA_TOOL_MODE ?? "json",
  };
}
