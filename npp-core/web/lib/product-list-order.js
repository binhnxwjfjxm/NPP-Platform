function createdAtMillis(product) {
  const parsed = Date.parse(String(product?.created_at ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareProductCreation(left, right) {
  const timeDifference = createdAtMillis(left) - createdAtMillis(right);
  if (timeDifference !== 0) return timeDifference;
  return String(left?.id ?? '').localeCompare(String(right?.id ?? ''));
}

export function productCreationSequence(products) {
  const ordered = [...(Array.isArray(products) ? products : [])].sort(compareProductCreation);
  return new Map(ordered.map((product, index) => [product.id, index + 1]));
}

export function sortProductsNewestFirst(products) {
  return [...(Array.isArray(products) ? products : [])]
    .sort((left, right) => compareProductCreation(right, left));
}
