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
      : this.repository.browse(intent.maxPrice);
  }
  details(id: string) {
    return this.repository.findById(id);
  }
}
