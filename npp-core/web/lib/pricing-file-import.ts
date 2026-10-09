export type PricingImportResult = {
  itemsCreated: number;
  itemsUpdated: number;
  itemsReplaced?: number;
  totalItems: number;
};
type PricingImportPayload = { items: unknown[]; [field: string]: unknown };
type PricingImportEnvelope = {
  data?: PricingImportResult;
  error?: { code?: string; message?: string };
};
type PricingImportOptions = {
  payload: PricingImportPayload;
  operationKey: string;
  onChecking?: () => void;
  fetchImpl?: typeof fetch;
  pause?: (milliseconds: number) => Promise<void>;
  maxAttempts?: number;
};

const MAX_CONFIRM_ATTEMPTS = 36;
const CONFIRM_INTERVAL_MS = 2_000;

export class PricingImportUnconfirmedError extends Error {
  constructor() {
    super('Chưa xác nhận được kết quả lưu giá. Không tải lại tệp hay tạo lần nhập mới; bấm “Kiểm tra lại kết quả” để tiếp tục kiểm tra thao tác cũ.');
    this.name = 'PricingImportUnconfirmedError';
  }
}

class PricingImportRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingImportRejectedError';
  }
}

/**
 * A POST may finish writing on Công Ty even when the browser receives 503.
 * Retry ONLY the same payload + shared canonical Idempotency-Key until the
 * backend replays the committed result. Never infer failure from a timeout.
 */
export async function importPricingFileWithConfirmation({
  payload, operationKey, onChecking, fetchImpl = fetch,
  pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxAttempts = MAX_CONFIRM_ATTEMPTS,
}: PricingImportOptions): Promise<PricingImportResult> {
  if (!operationKey || !payload.items.length) throw new Error('Thiếu thông tin của lần nhập giá.');
  const body = JSON.stringify(payload);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl('/api/pricing/import', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationKey },
        body,
      });
      const envelope = await response.json().catch(() => null) as PricingImportEnvelope | null;
      if (response.ok) {
        const result = envelope?.data;
        if (result && result.totalItems === payload.items.length) return result;
        // An incomplete/malformed response cannot prove this import failed.
      } else {
        const code = envelope?.error?.code ?? '';
        const pending = response.status === 409 && code === 'IDEMPOTENCY_IN_PROGRESS';
        const temporarilyUnavailable = [502, 503, 504].includes(response.status);
        if (!pending && !temporarilyUnavailable) {
          throw new PricingImportRejectedError(
            envelope?.error?.message || code || 'Không thể nhập giá. Vui lòng kiểm tra dữ liệu.',
          );
        }
      }
    } catch (error) {
      if (error instanceof PricingImportRejectedError) throw error;
      // A dropped connection is ambiguous; the original write may commit.
    }
    onChecking?.();
    if (attempt + 1 < maxAttempts) await pause(CONFIRM_INTERVAL_MS);
  }
  throw new PricingImportUnconfirmedError();
}
