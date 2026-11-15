import { products } from "@/data/products";
import { catalogFingerprint } from "@/infrastructure/catalog/index-document";
import {
  embeddingIdentity,
  type EmbeddingProfile,
} from "@/infrastructure/embeddings/profiles";
import { readFileSync } from "node:fs";
import { join } from "node:path";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Liveness never loads ONNX or LanceDB. A build manifest identifies the prepared index.
export function GET() {
  const profile = (process.env.EMBEDDING_MODEL ?? "bge") as EmbeddingProfile;
  const fingerprint = catalogFingerprint(products, embeddingIdentity(profile));
  let prepared: unknown;
  try {
    prepared = JSON.parse(
      readFileSync(
        join(
          process.env.LANCEDB_DIR ?? ".data/lancedb",
          `prepared-${profile}.json`,
        ),
        "utf8",
      ),
    );
  } catch {
    prepared = null;
  }
  return Response.json(
    {
      status: "ok",
      service: "aurelle",
      revision:
        process.env.RENDER_GIT_COMMIT ?? process.env.APP_REVISION ?? "local",
      embeddingProfile: profile,
      productCount: products.length,
      indexFingerprint: fingerprint,
      preparedIndex: prepared,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
