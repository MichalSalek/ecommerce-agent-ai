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
  async search({ query, maxPrice }: ProductSearch): Promise<Product[]> {
    if (maxPrice !== undefined && (!Number.isFinite(maxPrice) || maxPrice < 0))
      throw new RangeError(
        "Maximum price must be a non-negative finite number.",
      );
    const table = await this.prepare();
    const vector = await this.embedding.embedQuery(query);
    let search = table.vectorSearch(vector).distanceType("cosine");
    if (maxPrice !== undefined) search = search.where(`price <= ${maxPrice}`);
    const rows = await search.limit(2).toArray();
    const products = rows
      .filter((row) => Number(row._distance) <= 0.45)
      .map((row) => productSchema.parse(row));
    console.log(`[VECTOR] search returned ${products.length} products`);
    return products;
  }
  async browse(maxPrice?: number): Promise<Product[]> {
    if (maxPrice !== undefined && (!Number.isFinite(maxPrice) || maxPrice < 0))
      throw new RangeError("Invalid maximum price.");
    const table = await this.prepare();
    let query = table.query();
    if (maxPrice !== undefined) query = query.where(`price <= ${maxPrice}`);
    const rows = await query.toArray();
    return rows
      .map((row) => productSchema.parse(row))
      .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))
      .slice(0, 12);
  }
  async findById(id: string) {
    return this.catalog.find((product) => product.id === id);
  }
}
