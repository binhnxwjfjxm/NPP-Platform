export type InventoryPageRequest = Readonly<{
  limit: number;
  offset: number;
}>;

type InventoryPageLoader<T> = (page: InventoryPageRequest) => Promise<T[]>;

export function withInventoryPage(
  searchParams: URLSearchParams | undefined,
  page: InventoryPageRequest,
): URLSearchParams {
  const params = new URLSearchParams(searchParams);
  params.set('limit', String(page.limit));
  params.set('offset', String(page.offset));
  return params;
}

export async function collectInventoryPages<T>({
  pageSize,
  loadPage,
}: {
  pageSize: number;
  loadPage: InventoryPageLoader<T>;
}): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new Error('Kích thước trang dữ liệu Kho không hợp lệ.');
  }

  const rows: T[] = [];
  let offset = 0;

  while (true) {
    const batch = await loadPage({ limit: pageSize, offset });
    if (!Array.isArray(batch) || batch.length > pageSize) {
      throw new Error('Phản hồi phân trang dữ liệu Kho không hợp lệ.');
    }
    rows.push(...batch);
    if (batch.length < pageSize) return rows;

    const nextOffset = offset + pageSize;
    if (!Number.isSafeInteger(nextOffset)) {
      throw new Error('Dữ liệu Kho vượt phạm vi đánh số an toàn. Vui lòng liên hệ quản trị hệ thống.');
    }
    offset = nextOffset;
  }
}
