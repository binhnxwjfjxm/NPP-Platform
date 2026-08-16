import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

export function withFoundationRequestContext(context, callback) {
  if (!context || typeof callback !== "function") throw new TypeError("request_context_store_invalid");
  return storage.run(context, callback);
}

export function currentFoundationRequestContext() {
  return storage.getStore() || null;
}
