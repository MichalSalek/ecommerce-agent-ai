import { getShop } from "../src/composition/shop";
import { products } from "../src/data/products";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const { repository } = getShop();
await repository.prepare();
const directory = process.env.LANCEDB_DIR ?? ".data/lancedb";
await mkdir(directory, { recursive: true });
await writeFile(
  join(directory, `prepared-${process.env.EMBEDDING_MODEL ?? "bge"}.json`),
  JSON.stringify({
    fingerprint: repository.fingerprint,
    productCount: products.length,
  }),
);
console.log(
  `[VECTOR] catalog ready: ${products.length} products, products_${repository.fingerprint}`,
);
