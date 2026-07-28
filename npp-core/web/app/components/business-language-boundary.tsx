'use client';

import { useEffect, useRef, type ReactNode } from 'react';

type Scope = 'pricing' | 'document-numbering' | 'inventory';

type Props = {
  scope: Scope;
  children: ReactNode;
};

const COPY: Record<Scope, Record<string, string>> = {
  pricing: {
    'Thử giá': 'Kiểm tra giá áp dụng',
    'Priority càng lớn càng được xét trước; giá không nằm trong code.': 'Khi nhiều bảng giá cùng phù hợp, hệ thống ưu tiên bảng có số cao hơn.',
    Priority: 'Thứ tự ưu tiên áp dụng',
    'Thử giá & giải thích': 'Kiểm tra giá áp dụng',
    'Chọn ngữ cảnh để xem giá nền, rule áp dụng, rule bị bỏ qua và giá cuối.': 'Chọn hàng hóa, khách hàng, kênh bán và số lượng để xem giá cuối cùng cùng lý do hệ thống chọn bảng giá.',
    'Mã rule ngoài': 'Mã quy tắc từ hệ thống khác',
    'Phân giải giá': 'Kiểm tra giá',
    'Trace áp giá': 'Diễn giải cách tính giá',
    'Xử lý': 'Cách kết hợp',
    'Độc quyền': 'Chỉ áp dụng một bảng',
    'Được cộng dồn': 'Có thể cộng dồn',
    'Dừng sau khi áp': 'Dừng xét bảng giá sau khi áp dụng',
    'Nguồn': 'Nguồn thiết lập',
    ADMIN: 'Nhập từ màn quản trị',
    'Quy tắc khác': 'Chính sách giá khác',
  },
  'document-numbering': {
    'NPP Document Numbering': 'Thiết lập số chứng từ',
    'Phase 3.3F': 'Thiết lập vận hành',
    'Bộ máy cấp số dùng chung': 'Tự động tạo số chứng từ',
    'Cấu hình mẫu số theo từng loại chứng từ. Series đã phát sinh số sẽ khóa định dạng để bảo vệ lịch sử.': 'Tạo số phiếu và hóa đơn tự động, duy nhất, đúng thứ tự. Sau khi đã sử dụng, định dạng sẽ được khóa để bảo vệ lịch sử.',
    'Thêm series': 'Thêm quy tắc đánh số',
    'Mã series': 'Mã quy tắc',
    'Tên series': 'Tên quy tắc',
    'Tạo series số chứng từ': 'Tạo quy tắc đánh số chứng từ',
    'Lưu series': 'Lưu quy tắc',
    'Đã cập nhật series số chứng từ': 'Đã cập nhật quy tắc đánh số chứng từ',
    'Đã tạo series số chứng từ': 'Đã tạo quy tắc đánh số chứng từ',
    'Đã kích hoạt series': 'Đã kích hoạt quy tắc',
    'Đã ngừng series': 'Đã ngừng quy tắc',
    Reset: 'Chu kỳ đánh lại số',
    'Không reset': 'Không đánh lại số',
    'Độ rộng số': 'Số chữ số',
    'Số bắt đầu': 'Số thứ tự tiếp theo',
    'Mẫu số': 'Mẫu số chứng từ',
    'Token: {PREFIX} {YYYY} {YY} {MM} {SEQ}': 'Biến dùng trong mẫu: {PREFIX} {YYYY} {YY} {MM} {SEQ}. Ví dụ: HĐ-2026-000001',
    'Cấp số kiểm thử': 'Kiểm tra số sẽ tạo',
    'Thao tác này tạo một allocation bất biến để kiểm thử bộ đếm. Nó không tạo đơn bán, phiếu kho, hóa đơn hay bút toán.': 'Thao tác này chỉ kiểm tra số tiếp theo và ghi vào lịch sử thử nghiệm; không tạo đơn bán, phiếu kho, hóa đơn hay bút toán.',
    'Khóa idempotency': 'Mã chống tạo trùng',
    'Tạo khóa mới': 'Tạo mã thử mới',
    Replay: 'Dùng lại kết quả cũ',
    'Bộ đếm': 'Số thứ tự',
    'Trạng thái theo kỳ': 'Số tiếp theo theo từng kỳ',
    'Lịch sử bất biến': 'Lịch sử đã cấp',
    'Định dạng đã khóa vì series có lịch sử cấp số.': 'Định dạng đã khóa vì quy tắc này đã phát sinh số chứng từ.',
    'Chưa có series phù hợp': 'Chưa có quy tắc đánh số phù hợp',
  },
  inventory: {
    'Tồn kho': 'Tra cứu tồn kho',
    'Nhập tồn đầu kỳ': 'Thiết lập tồn đầu kỳ',
    'Về tồn kho': 'Về tra cứu tồn kho',
    'Số dư tồn kho': 'Tra cứu tồn kho',
    'Bảng điều khiển này bám dữ liệu thật từ Core API: số dư, lô, chính sách và nhập tồn đầu kỳ.': 'Tổng hợp số lượng hiện tại, lô hàng, chính sách theo dõi và dữ liệu tồn đầu kỳ.',
    'Xem số dư chính xác theo kho, vị trí, SKU cơ sở, lô và hạn dùng. Mở chi tiết lấy trực tiếp từ sổ cái tồn kho.': 'Xem số lượng hiện tại, đang giữ, khả dụng và vị trí hàng theo kho, SKU, lô và hạn dùng.',
    'Quy tắc lô, hạn dùng và vị trí được lưu với cập nhật lạc quan và ghi nhận nghiệp vụ thật.': 'Thiết lập cách quản lý lô, hạn sử dụng và vị trí hàng; hệ thống kiểm soát xung đột khi nhiều người cùng cập nhật.',
    'Danh sách lô chuẩn được dùng lại khi ghi sổ mở tồn và truy vết tồn kho.': 'Danh sách lô hàng dùng để ghi nhận tồn đầu kỳ và truy vết hàng hóa.',
    'Nhập tồn đầu kỳ nhận JSON chuẩn hóa, kiểm tra trước, rồi ghi sổ nguyên tử vào sổ cái tồn kho.': 'Thiết lập tồn đầu kỳ là thao tác một lần khi bắt đầu dùng hệ thống hoặc chuyển dữ liệu cũ. Dữ liệu được kiểm tra trước khi ghi nhận.',
    'Tồn kho, lô và nhập đầu kỳ': 'Quản lý tồn kho',
    'Giai đoạn 4.4': 'Quản lý kho',
    'Số dư': 'Dòng tồn kho',
    'Các dòng số dư chính xác đang hiển thị.': 'Các dòng tồn kho hiện đang hiển thị.',
    'Lô canonical theo SKU cơ sở.': 'Các lô hàng theo SKU cơ sở.',
    'Nhập tồn': 'Lần thiết lập đầu kỳ',
    'Tồn thực': 'Số lượng hiện tại',
    'Đã giữ': 'Đang giữ',
    'Xem chi tiết giao dịch': 'Lịch sử biến động tồn kho',
    'Chọn một dòng số dư để xem các dòng giao dịch.': 'Chọn một dòng tồn kho để xem lịch sử nhập, xuất và điều chỉnh.',
    'Danh sách lô chuẩn theo SKU cơ sở, có hạn dùng và metadata.': 'Danh sách lô hàng theo SKU cơ sở, ngày sản xuất, hạn dùng và thông tin liên quan.',
    'Mã biến thể cơ sở': 'SKU cơ sở',
    'UUID biến thể cơ sở': 'Chọn hoặc nhập mã SKU cơ sở',
    'Chế độ lô': 'Quản lý theo lô',
    'Chế độ hạn dùng': 'Quản lý hạn sử dụng',
    'Phiên bản dự kiến': 'Phiên bản dữ liệu hiện tại',
    NONE: 'Không áp dụng',
    OPTIONAL: 'Không bắt buộc',
    REQUIRED: 'Bắt buộc',
    'Nhập JSON dòng chuẩn hóa, kiểm tra trước rồi ghi sổ nguyên tử vào sổ cái tồn kho.': 'Dữ liệu tồn đầu kỳ được kiểm tra trước khi ghi nhận vào hệ thống.',
    'Mã nguồn': 'Mã lần nhập',
    'Tên tệp nguồn': 'Tên tệp dữ liệu',
    'Metadata dạng JSON': 'Thông tin bổ sung',
    'Danh sách dòng dạng JSON': 'Dữ liệu các dòng hàng',
    'Mỗi dòng phải có warehouseId, sourceVariantId và sourceQuantity. lotCode / expiryDate dùng theo chính sách lô.': 'Mỗi dòng cần có kho, SKU và số lượng. Thông tin lô và hạn dùng áp dụng theo chính sách đã thiết lập.',
    'Ghi sổ nhập tồn': 'Xác nhận ghi nhận tồn đầu kỳ',
    'Kết quả kiểm tra / ghi sổ': 'Kết quả kiểm tra và ghi nhận',
    'Không có lỗi dòng. Có thể ghi sổ ngay.': 'Không có dòng lỗi. Có thể xác nhận ghi nhận tồn đầu kỳ.',
    'Kết quả ghi sổ': 'Kết quả ghi nhận',
    'Chưa có import nào.': 'Chưa có lần thiết lập tồn đầu kỳ nào.',
  },
};

function replaceExact(value: string, dictionary: Record<string, string>): string {
  return dictionary[value.trim()] ?? value;
}

function translateElement(root: HTMLElement, dictionary: Record<string, string>) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const node of textNodes) {
    const raw = node.nodeValue ?? '';
    const leading = raw.match(/^\s*/)?.[0] ?? '';
    const trailing = raw.match(/\s*$/)?.[0] ?? '';
    const translated = replaceExact(raw, dictionary);
    if (translated !== raw) node.nodeValue = `${leading}${translated.trim()}${trailing}`;
  }

  for (const element of root.querySelectorAll<HTMLElement>('[placeholder], [title], [aria-label]')) {
    for (const attribute of ['placeholder', 'title', 'aria-label']) {
      const current = element.getAttribute(attribute);
      if (!current) continue;
      const translated = replaceExact(current, dictionary);
      if (translated !== current) element.setAttribute(attribute, translated);
    }
  }
}

export default function BusinessLanguageBoundary({ scope, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const dictionary = COPY[scope];
    translateElement(root, dictionary);
    const observer = new MutationObserver(() => translateElement(root, dictionary));
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
    return () => observer.disconnect();
  }, [scope]);

  return <div ref={ref} data-business-language-scope={scope}>{children}</div>;
}
