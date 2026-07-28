'use client';

import { useEffect, type ReactNode } from 'react';

type Props = { scope: 'overview' | 'warehouses'; children: ReactNode };

const TYPE_LABELS: Record<string, string> = {
  main: 'Kho tổng',
  distribution: 'Kho bán hàng / phân phối',
  vehicle: 'Kho xe giao hàng',
  quarantine: 'Kho chờ kiểm',
  returns: 'Kho hàng lỗi / trả lại',
  transit: 'Kho trung chuyển',
  other: 'Kho mục đích khác',
};

export default function OrganizationLot3Boundary({ scope, children }: Props) {
  useEffect(() => {
    if (scope !== 'warehouses') return;
    const select = document.querySelector<HTMLSelectElement>('[data-testid="warehouse-type-select"]');
    if (!select) return;
    for (const option of Array.from(select.options)) {
      option.text = TYPE_LABELS[option.value] ?? option.text;
    }
    if (!select.parentElement?.querySelector('[data-warehouse-type-help]')) {
      const help = document.createElement('small');
      help.dataset.warehouseTypeHelp = 'true';
      help.textContent = 'Loại kho là danh sách cố định để phân loại và báo cáo. Hiện chưa điều khiển quyền nhập/xuất, nên người dùng không thể tự tạo loại mới.';
      select.insertAdjacentElement('afterend', help);
    }
  }, [scope]);

  return <div data-lot3-organization-scope={scope}>{children}</div>;
}
