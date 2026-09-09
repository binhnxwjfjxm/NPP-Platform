type ProductCreationItem = {
  id: string;
  created_at?: string | null;
};

export function productCreationSequence<T extends ProductCreationItem>(products: readonly T[]): Map<string, number>;
export function sortProductsNewestFirst<T extends ProductCreationItem>(products: readonly T[]): T[];
