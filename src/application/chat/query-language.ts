import { products } from "@/data/products";
import { productKinds, productTypes } from "@/domain/catalog/taxonomy";
const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ł", "l");
const words = (text: string) =>
  fold(text)
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 4);
const englishStems = new Set(
  words(
    products
      .map((product) =>
        [
          product.name,
          product.category,
          product.productKind,
          product.productType,
          product.description,
          product.fullDescription,
          product.material,
          ...product.features,
        ].join(" "),
      )
      .join(" ") +
      " " +
      Object.values({ ...productKinds, ...productTypes })
        .map((value) => value.en)
        .join(" "),
  ).map((word) => word.slice(0, 3)),
);
const polishStems = new Set(
  Object.values({ ...productKinds, ...productTypes })
    .flatMap((value) => words([value.pl, ...value.aliases].join(" ")))
    .map((word) => word.slice(0, 3))
    .filter((stem) => !englishStems.has(stem)),
);
/** Validate encoder input language; this does not translate or interpret shopping intent. */
export function queryLanguageError(query: string | undefined) {
  if (
    query &&
    (/[ąćęłńóśźż]/i.test(query) ||
      words(query).some((word) => polishStems.has(word.slice(0, 3))))
  )
    return {
      error:
        "The encoder accepts English queries. Translate the semantic query to English before retrying (for example, morning coffee).",
      code: "QUERY_LANGUAGE",
    };
}
