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
export function chatConfig() {
  return {
    provider: process.env.CHAT_PROVIDER ?? "llama",
    baseURL: process.env.LLAMA_BASE_URL ?? "http://127.0.0.1:8080/v1",
    modelId: process.env.LLAMA_MODEL,
    groq: {
      baseURL: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
      modelId: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
      apiKey: process.env.GROQ_API_KEY,
      ...(process.env.GROQ_FALLBACK_MODEL && process.env.GROQ_FALLBACK_API_KEY
        ? {
            fallback: {
              modelId: process.env.GROQ_FALLBACK_MODEL,
              apiKey: process.env.GROQ_FALLBACK_API_KEY,
            },
          }
        : {}),
      balancer: process.env.GROQ_BALANCER === "true",
      windowsTransport: process.env.GROQ_TRANSPORT === "windows",
    },
  };
}
