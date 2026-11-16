import Link from "next/link";
import { StoreImage } from "@/components/StoreImage";
import { products } from "@/data/products";
import type { CategoryCard } from "@/application/chat/shopping-v3";

export function CategoryResults({
  categories,
  onSelect,
  disabled,
}: {
  categories: CategoryCard[];
  onSelect: (name: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="category-results" aria-label="Product categories">
      {categories.map((category) => {
        const example = products.find(
          (product) => product.id === category.exampleId,
        );
        return (
          <div className="category-result" key={category.name}>
            {example && (
              <Link
                className="category-example"
                href={example.productUrl}
                aria-label={`View ${example.name}`}
              >
                <StoreImage
                  src={example.imageUrl}
                  alt={example.name}
                  width={160}
                  height={160}
                  sizes="80px"
                />
                <span>
                  {example.name}
                  {!example.inStock ? " (out of stock)" : ""}
                </span>
              </Link>
            )}
            <div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(category.name)}
              >
                {category.name}
              </button>
              <span>
                {category.count} {category.count === 1 ? "product" : "products"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
