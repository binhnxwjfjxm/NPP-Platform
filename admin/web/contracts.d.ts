declare module '@npp/contracts' {
  export function createIdempotencyKey(operation: string, uuid?: string): string;
}
