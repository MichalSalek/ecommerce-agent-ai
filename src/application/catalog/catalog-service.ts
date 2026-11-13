import type {
  ProductRepository,
  ProductSearch,
} from "@/domain/catalog/product";
import { parseSearchIntent } from "./search-intent";
export class CatalogService {
  constructor(private readonly repository: ProductRepository) {}
  search(criteria: ProductSearch) {
    const intent = parseSearchIntent(criteria);
    return intent.query
      ? this.repository.search(intent)
      : this.repository.browse(intent.maxPrice, intent);
  }
  categories() {
    return this.repository.categories();
  }
  async compare(ids: string[]) {
    const found = await Promise.all(
      ids.map((id) => this.repository.findById(id)),
    );
    return {
      products: found.filter(
        (p): p is NonNullable<typeof p> => p !== undefined,
      ),
      missingIds: ids.filter((_, i) => !found[i]),
    };
  }
  details(id: string) {
    return this.repository.findById(id);
  }
}
