import type { ProductRepository } from "../src/domain/catalog/product";
type LegacyRepository = Omit<ProductRepository, "searchResult" | "overview">;
/** Keep transport fixtures explicit while production retrieval tests use actual LanceDB. */
export function repositoryFixture(
  repository: LegacyRepository,
): ProductRepository {
  return {
    ...repository,
    searchResult: async (criteria) => {
      const products = criteria.query
        ? await repository.search(criteria)
        : await repository.browse(criteria.maxPrice, criteria);
      return {
        products,
        totalMatches: products.length,
        unseenMatches: products.length,
        remainingMatches: 0,
      };
    },
    overview: async () => ({ total: 0, categories: [], types: [] }),
  };
}
