export function createMockRequest(overrides = {}) {
  return {
    method: 'GET',
    url: '/',
    headers: {},
    ...overrides,
  };
}

export function createMockPool(queryImpl) {
  return {
    query: queryImpl ?? (async () => ({ rows: [{ '?column?': 1 }] })),
    end: async () => true,
  };
}
