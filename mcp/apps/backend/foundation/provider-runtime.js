let activePersistence = null;

function runtimeError(code) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = 503;
  return error;
}

export function bindProviderPersistence(persistence) {
  if (!persistence || typeof persistence.readiness !== "function") {
    throw new TypeError("persistence_adapter_required");
  }
  activePersistence = persistence;
}

export function providerPersistence() {
  if (!activePersistence) throw runtimeError("persistence_not_bound");
  return activePersistence;
}
