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
    provider: process.env.CHAT_PROVIDER ?? "llama",
    baseURL: process.env.LLAMA_BASE_URL ?? "http://127.0.0.1:8080/v1",
    modelId: process.env.LLAMA_MODEL,
    groq: {
      baseURL: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
      modelId: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
      apiKey: process.env.GROQ_API_KEY,
      balancer: process.env.GROQ_BALANCER === "true",
      windowsTransport: process.env.GROQ_TRANSPORT === "windows",
    },
  };
}
