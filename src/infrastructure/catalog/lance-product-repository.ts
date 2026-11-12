import type { TextEmbedding } from "@/application/catalog/text-embedding";
import { connect, type Table } from "@lancedb/lancedb";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  productSchema,
  type Product,
  type ProductRepository,
  type ProductSearch,
} from "@/domain/catalog/product";
export class LanceProductRepository implements ProductRepository {
  private table?: Promise<Table>;
  constructor(
    private readonly directory: string,
    private readonly embedding: TextEmbedding,
    private readonly catalog: readonly Product[],
  ) {}
  private async open(): Promise<Table> {
    const database = await connect(resolve(this.directory));
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          embedding: this.embedding.identity,
          catalog: this.catalog,
        }),
      )
      .digest("hex")
      .slice(0, 16);
    const name = `products_${fingerprint}`;
    if ((await database.tableNames()).includes(name))
      return database.openTable(name);
    const vectors = await this.embedding.embedDocuments(
      this.catalog.map(
        (p) => `${p.name}. ${p.description} Category: ${p.category}.`,
      ),
    );
    const rows = this.catalog.map((product, index) => ({
      ...product,
      vector: vectors[index],
    }));
    // A content-addressed table prevents stale catalog/model vectors. Concurrent processes may publish the same table.
    try {
      const table = await database.createTable(name, rows);
      console.log(
        `[VECTOR] indexed ${rows.length} products (${this.embedding.dimensions} dimensions)`,
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
  private filters(criteria: ProductSearch): string[] {
    const filters: string[] = [];
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
    // Resolve filter strings against canonical IDs/categories before interpolation.
    if (criteria.category) {
      const category = this.catalog.find(
        (p) => p.category.toLowerCase() === criteria.category!.toLowerCase(),
      )?.category;
      if (!category) return ["price < 0"];
      filters.push(`category = '${category.replaceAll("'", "''")}'`);
    }
    const excluded = this.catalog
      .filter((p) => criteria.excludeIds?.includes(p.id))
      .map((p) => `'${p.id.replaceAll("'", "''")}'`);
    if (excluded.length) filters.push(`id NOT IN (${excluded.join(",")})`);
    return filters;
  }
  async search(criteria: ProductSearch): Promise<Product[]> {
    const filters = this.filters(criteria);
    const table = await this.prepare();
    const vector = await this.embedding.embedQuery(criteria.query);
    let search = table.vectorSearch(vector).distanceType("cosine");
    if (filters.length) search = search.where(filters.join(" AND "));
    const rows = await search
      .limit(
        criteria.targetPrice !== undefined
          ? this.catalog.length
          : Math.min(criteria.limit ?? 2, 12),
      )
      .toArray();
    const matches = rows
      .filter((row) => Number(row._distance) <= 0.45)
      .map((row) => productSchema.parse(row));
    if (criteria.targetPrice !== undefined)
      matches.sort(
        (a, b) =>
          Math.abs(a.price - criteria.targetPrice!) -
          Math.abs(b.price - criteria.targetPrice!),
      );
    const result = matches.slice(0, Math.min(criteria.limit ?? 2, 12));
    console.log(`[VECTOR] search returned ${result.length} products`);
    return result;
  }
  async browse(
    maxPrice?: number,
    options: Omit<ProductSearch, "query" | "maxPrice"> = {},
  ): Promise<Product[]> {
    const criteria = { query: "", ...options, maxPrice };
    const filters = this.filters(criteria);
    const table = await this.prepare();
    let query = table.query();
    if (filters.length) query = query.where(filters.join(" AND "));
    const rows = await query.toArray();
    const target = options.targetPrice;
    return rows
      .map((row) => productSchema.parse(row))
      .sort((a, b) =>
        target !== undefined
          ? Math.abs(a.price - target) - Math.abs(b.price - target) ||
            a.id.localeCompare(b.id)
          : a.price - b.price || a.id.localeCompare(b.id),
      )
      .slice(0, Math.min(options.limit ?? 12, 12));
  }
  async categories() {
    return [...new Set(this.catalog.map((p) => p.category))].sort();
  }
  async findById(id: string) {
    return this.catalog.find((product) => product.id === id);
  }
}
