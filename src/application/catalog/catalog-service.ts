import type {
  ProductRepository,
  ProductSearch,
} from "@/domain/catalog/product";
export class CatalogService {
  constructor(private readonly repository: ProductRepository) {}
  search(criteria: ProductSearch) {
    // Budget is a structured filter, not part of the product meaning sent to the encoder.
    const query =
      criteria.maxPrice === undefined
        ? criteria.query
        : criteria.query
            .replace(
              /\b(?:under|below|up to|less than)\s*(?:EUR|€)?\s*\d+(?:[.,]\d+)?\s*(?:EUR|euros?)?\b/gi,
              " ",
            )
            .trim();
    return this.repository.search({ ...criteria, query });
  }
  details(id: string) {
    return this.repository.findById(id);
  }
}
