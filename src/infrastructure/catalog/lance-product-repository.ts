import type { TextEmbedding } from "@/application/catalog/text-embedding";
import { connect, type Table } from "@lancedb/lancedb";
import { resolve } from "node:path";
import {
  productSchema,
  type Product,
  type ProductRepository,
  type ProductSearch,
  type ProductSearchResult,
} from "@/domain/catalog/product";

export { indexingDocument, catalogFingerprint } from "./index-document";
import {
  indexingDocument,
  purposeDocument,
  catalogFingerprint,
} from "./index-document";
export class LanceProductRepository implements ProductRepository {
  private table?: Promise<Table>;
  constructor(
    private readonly directory: string,
    private readonly embedding: TextEmbedding,
    private readonly catalog: readonly Product[],
    private readonly maxDistance = 0.45,
  ) {}
  get fingerprint() {
    return catalogFingerprint(this.catalog, this.embedding.identity);
  }
  private async open(): Promise<Table> {
    const database = await connect(resolve(this.directory));
    const name = `products_${this.fingerprint}`;
    if ((await database.tableNames()).includes(name))
      return database.openTable(name);
    const detailed = await this.embedding.embedDocuments(
      this.catalog.map(indexingDocument),
    );
    const purpose = await this.embedding.embedDocuments(
      this.catalog.map(purposeDocument),
    );
    // Equal field weighting preserves the shopping purpose alongside longer specifications.
    const vectors = detailed.map((vector, i) => {
      const mean = vector.map((value, j) => (value + purpose[i][j]) / 2);
      const norm = Math.hypot(...mean);
      return mean.map((value) => value / norm);
    });
    const rows = this.catalog.map((product, index) => ({
      ...product,
      vector: vectors[index],
    }));
    // Content-addressed tables preserve active indices and isolate encoder spaces.
    try {
      const table = await database.createTable(name, rows);
      console.log(
        `[VECTOR] indexed ${rows.length} products (${this.embedding.dimensions} dimensions), ${name}`,
      );
      return table;
    } catch (error) {
      if ((await database.tableNames()).includes(name))
        return database.openTable(name);
      throw error;
    }
  }
  async prepare() {
    this.table ??= this.open().catch((error) => {
      this.table = undefined;
      throw error;
    });
    return this.table;
  }
  private filters(criteria: ProductSearch, includeIds = false): string[] {
    const filters: string[] = [];
    if (criteria.inStockOnly) filters.push("inStock = true");
    for (const amount of [criteria.maxPrice, criteria.targetPrice])
      if (amount !== undefined && (!Number.isFinite(amount) || amount < 0))
        throw new RangeError("Price must be a non-negative finite number.");
    if (criteria.maxPrice !== undefined)
      filters.push(`price <= ${criteria.maxPrice}`);
    if (criteria.targetPrice !== undefined) {
      const tolerance = Math.max(5, criteria.targetPrice * 0.2);
      filters.push(
        `price >= ${Math.max(0, criteria.targetPrice - tolerance)} AND price <= ${criteria.targetPrice + tolerance}`,
      );
    }
    for (const key of ["category", "productKind", "productType"] as const) {
      if (!criteria[key]) continue;
      const canonical = this.catalog.find(
        (p) => p[key].toLowerCase() === criteria[key]!.toLowerCase(),
      )?.[key];
      if (!canonical) return ["price < 0"];
      filters.push(`${key} = '${canonical.replaceAll("'", "''")}'`);
    }
    if (criteria.useEnvironment)
      filters.push(
        criteria.useEnvironment === "both"
          ? "useEnvironment = 'both'"
          : `(useEnvironment = '${criteria.useEnvironment}' OR useEnvironment = 'both')`,
      );
    if (criteria.productTypes?.length) {
      const allowed = [
        ...new Set(this.catalog.map((p) => p.productType)),
      ].filter((type) => criteria.productTypes!.includes(type));
      filters.push(
        allowed.length
          ? `productType IN (${allowed.map((type) => `'${type.replaceAll("'", "''")}'`).join(",")})`
          : "price < 0",
      );
    }
    const excludedTypes = this.catalog
      .filter((p) => criteria.excludeTypes?.includes(p.productType))
      .map((p) => `'${p.productType.replaceAll("'", "''")}'`);
    if (excludedTypes.length)
      filters.push(
        `productType NOT IN (${[...new Set(excludedTypes)].join(",")})`,
      );
    if (criteria.requiredFeatures?.length) {
      const eligible = this.catalog.filter((p) =>
        criteria.requiredFeatures!.every((feature) =>
          `${p.material} ${p.features.join(" ")}`
            .toLowerCase()
            .includes(feature.toLowerCase()),
        ),
      );
      filters.push(
        eligible.length
          ? `id IN (${eligible.map((p) => `'${p.id.replaceAll("'", "''")}'`).join(",")})`
          : "price < 0",
      );
    }
    if (includeIds) {
      const ids = this.catalog.filter((p) =>
        criteria.excludeIds?.includes(p.id),
      );
      if (ids.length)
        filters.push(
          `id NOT IN (${ids.map((p) => `'${p.id.replaceAll("'", "''")}'`).join(",")})`,
        );
    }
    return filters;
  }
  async searchResult(criteria: ProductSearch): Promise<ProductSearchResult> {
    const table = await this.prepare();
    const filters = this.filters(criteria);
    const vector = criteria.query.trim()
      ? await this.embedding.embedQuery(criteria.query)
      : undefined;
    const fetchRows = async (conditions: string[]) => {
      if (vector) {
        let query = table.vectorSearch(vector).distanceType("cosine");
        if (conditions.length) query = query.where(conditions.join(" AND "));
        return query.limit(this.catalog.length).toArray();
      }
      let query = table.query();
      if (conditions.length) query = query.where(conditions.join(" AND "));
      return query.toArray();
    };
    const ranked = await fetchRows(filters);
    // Keep one relevance universe across pages; pagination never loosens its cutoff.
    const cutoff = vector
      ? Math.min(this.maxDistance, Number(ranked[0]?._distance ?? 0) + 0.2)
      : Infinity;
    const relevant = (row: Record<string, unknown>) =>
      !vector || Number(row._distance) <= cutoff;
    const totalMatches = ranked.filter(relevant).length;
    // Display candidates are ranked only after ID exclusions, using Lance prefiltering.
    const visible = criteria.excludeIds?.length
      ? await fetchRows(this.filters(criteria, true))
      : ranked;
    const unseen = visible
      .filter(relevant)
      .map((row) =>
        productSchema.parse({
          ...row,
          features: Array.from(row.features),
          limitations: Array.from(row.limitations),
        }),
      );
    if (criteria.targetPrice !== undefined)
      unseen.sort(
        (a, b) =>
          Math.abs(a.price - criteria.targetPrice!) -
            Math.abs(b.price - criteria.targetPrice!) ||
          a.id.localeCompare(b.id),
      );
    else if (!vector)
      unseen.sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
    const products = unseen.slice(
      0,
      Math.max(1, Math.min(criteria.limit ?? 2, 12)),
    );
    return {
      products,
      totalMatches,
      unseenMatches: unseen.length,
      remainingMatches: unseen.length - products.length,
    };
  }
  async search(criteria: ProductSearch): Promise<Product[]> {
    return (await this.searchResult(criteria)).products;
  }
  async browse(
    maxPrice?: number,
    options: Omit<ProductSearch, "query" | "maxPrice"> = {},
  ): Promise<Product[]> {
    return this.search({ query: "", limit: 12, ...options, maxPrice });
  }
  async overview(criteria: Partial<ProductSearch> = {}) {
    // Use the same structural filters as retrieval, never a parallel list of merchandise claims.
    const table = await this.prepare();
    const filters = this.filters({ query: "", ...criteria }, true);
    let query = table.query();
    if (filters.length) query = query.where(filters.join(" AND "));
    const all = (await query.toArray())
      .map((p) =>
        productSchema.parse({
          ...p,
          features: Array.from(p.features),
          limitations: Array.from(p.limitations),
        }),
      )
      .filter((p) => !criteria.excludeIds?.includes(p.id));
    return {
      total: all.length,
      categories: [...new Set(all.map((p) => p.category))]
        .sort()
        .map((name) => ({
          name,
          count: all.filter((p) => p.category === name).length,
        })),
      types: [...new Set(all.map((p) => p.productType))].sort().map((type) => ({
        type,
        kind: all.find((p) => p.productType === type)!.productKind,
        count: all.filter((p) => p.productType === type).length,
      })),
    };
  }
  async categories() {
    return [...new Set(this.catalog.map((p) => p.category))].sort();
  }
  async findById(id: string) {
    return this.catalog.find((p) => p.id === id);
  }
}
