import { createHash } from "node:crypto";
import type { Product } from "@/domain/catalog/product";
export function purposeDocument(p: Product): string {
  return `${p.name}. ${p.description}`;
}
export function indexingDocument(p: Product): string {
  const additional = [...p.features, ...p.limitations].filter(
    (fact) => !p.fullDescription.includes(fact),
  );
  return `${p.name}. ${p.description} ${p.fullDescription} Type: ${p.productType}; kind: ${p.productKind}; use: ${p.useEnvironment}.${additional.length ? ` ${additional.join("; ")}.` : ""}`;
}
export function catalogFingerprint(
  catalog: readonly Product[],
  embeddingIdentity: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        embedding: embeddingIdentity,
        catalog,
        documents: catalog.map((p) => [
          purposeDocument(p),
          indexingDocument(p),
        ]),
        representation: "normalized-field-mean-v1",
      }),
    )
    .digest("hex")
    .slice(0, 16);
}
