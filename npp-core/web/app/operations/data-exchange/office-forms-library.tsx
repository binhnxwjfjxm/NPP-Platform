'use client';

import { useMemo, useState } from 'react';
import BusinessDocumentPrint, { type BusinessDocumentColumn } from '../../components/business-document-print';
import { PrintAction } from '../../components/print-document';
import { exportTable } from './data-exchange-file-utils';
import styles from './office-forms-library.module.css';

type OfficeFormGroup = 'sales' | 'purchasing' | 'inventory' | 'logistics' | 'workforce';
type XlsxSpec = Readonly<{ headers: readonly string[]; blankRows?: number }>;
type PdfSpec = Readonly<{
  meta: readonly string[];
  columns?: readonly string[];
  signatures?: readonly string[];
  note?: string;
  size?: 'A4' | 'A5';
}>;
type OfficeForm = Readonly<{
  id: string;
  group: OfficeFormGroup;
  name: string;
  purpose: string;
  xlsx?: XlsxSpec;
  pdf?: PdfSpec;
}>;

const GROUP_LABELS: Readonly<Record<OfficeFormGroup, string>> = Object.freeze({
  sales: 'Bán hàng & khách hàng',
  purchasing: 'Mua hàng & Nhà cung cấp',
  inventory: 'Kho',
  logistics: 'Giao vận & COD',
  workforce: 'Nhân sự',
});

const ITEM_HEADERS = ['STT', 'Mã hàng', 'Tên hàng', 'ĐVT', 'Số lượng', 'Đơn giá', 'Thành tiền', 'Ghi chú'] as const;
const STOCK_HEADERS = ['STT', 'Mã hàng', 'Tên hàng', 'ĐVT', 'Vị trí', 'Lô', 'Số lượng', 'Ghi chú'] as const;
const RECON_HEADERS = ['STT', 'Ngày', 'Số chứng từ', 'Nội dung', 'Phát sinh', 'Đã thanh toán / đối trừ', 'Còn lại', 'Ghi chú'] as const;
const COD_HEADERS = ['STT', 'Ngày', 'Chuyến / phiếu giao', 'Khách hàng', 'Tiền phải thu', 'Tiền đã thu', 'Chênh lệch', 'Ghi chú'] as const;

function itemPdf(meta: readonly string[] = ['Ngày lập', 'Đối tác / bộ phận', 'Kho / địa điểm', 'Người lập']): PdfSpec {
  return { meta, columns: ITEM_HEADERS, signatures: ['Người lập', 'Bộ phận liên quan', 'Đối tác / Người nhận'] };
}
function stockPdf(meta: readonly string[] = ['Ngày lập', 'Kho', 'Bộ phận', 'Người lập']): PdfSpec {
  return { meta, columns: STOCK_HEADERS, signatures: ['Người lập', 'Thủ kho', 'Bộ phận liên quan'] };
}
function reconcilePdf(meta: readonly string[] = ['Đơn vị đối chiếu', 'Từ ngày', 'Đến ngày', 'Ngày lập']): PdfSpec {
  return { meta, columns: RECON_HEADERS, signatures: ['Người lập', 'Kế toán', 'Đối tác xác nhận'] };
}
function peoplePdf(meta: readonly string[], note?: string): PdfSpec {
  return { meta, signatures: ['Người lập / Nhân sự', 'Quản lý trực tiếp', 'Bộ phận Nhân sự'], note };
}

export const OFFICE_FORM_CATALOG: readonly OfficeForm[] = [
  {
    id: 'sales-order-blank',
    group: 'sales',
    name: 'Mẫu đơn bán hàng / phiếu đặt hàng khách hàng',
    purpose: 'Ghi nhận yêu cầu đặt hàng ngoài hệ thống trước khi nhập vào Công Ty.',
    xlsx: { headers: ITEM_HEADERS },
  },
  {
    id: 'quotation-blank',
    group: 'sales',
    name: 'Mẫu báo giá',
    purpose: 'Lập báo giá trống để điền, gửi khách hoặc in ký.',
    xlsx: { headers: ['STT', 'Mã hàng', 'Tên hàng', 'ĐVT', 'Số lượng', 'Đơn giá', 'Chiết khấu', 'Thành tiền', 'Ghi chú'] },
    pdf: itemPdf(['Khách hàng', 'Ngày báo giá', 'Hiệu lực đến', 'Người lập']),
  },
  {
    id: 'sales-warehouse-issue-blank',
    group: 'sales',
    name: 'Mẫu phiếu xuất kho',
    purpose: 'Phiếu trống dùng khi cần ghi nhận xuất hàng bán bằng bản giấy.',
    pdf: stockPdf(['Ngày xuất', 'Kho xuất', 'Khách hàng / bộ phận nhận', 'Người lập']),
  },
  {
    id: 'delivery-note-blank',
    group: 'sales',
    name: 'Mẫu phiếu giao hàng',
    purpose: 'Bản trống để bàn giao hàng và ký nhận ngoài hệ thống.',
    pdf: itemPdf(['Ngày giao', 'Khách hàng', 'Địa chỉ giao', 'Người giao']),
  },
  {
    id: 'packing-list-blank',
    group: 'sales',
    name: 'Mẫu phiếu đóng gói',
    purpose: 'Bản trống ghi nội dung kiện hàng trước khi bàn giao.',
    pdf: { ...itemPdf(['Ngày đóng gói', 'Khách hàng', 'Số kiện', 'Người đóng gói']), signatures: ['Người đóng gói', 'Người kiểm tra', 'Người nhận'] },
  },
  {
    id: 'customer-receipt-blank',
    group: 'sales',
    name: 'Mẫu phiếu thu',
    purpose: 'Phiếu trống ghi nhận khoản tiền khách hàng nộp bằng chứng từ giấy.',
    pdf: peoplePdf(['Ngày thu', 'Khách hàng / người nộp', 'Số tiền', 'Bằng chữ', 'Nội dung thu'], 'Kèm chứng từ liên quan khi có.'),
  },
  {
    id: 'customer-return-receipt-blank',
    group: 'sales',
    name: 'Mẫu phiếu nhận hàng khách trả',
    purpose: 'Ghi nhận hàng khách trả trước khi xử lý nghiệp vụ trên hệ thống.',
    pdf: itemPdf(['Ngày nhận', 'Khách hàng', 'Kho nhận', 'Lý do trả']),
  },
  {
    id: 'customer-refund-blank',
    group: 'sales',
    name: 'Mẫu phiếu hoàn tiền khách hàng',
    purpose: 'Phiếu trống xác nhận khoản hoàn tiền cho khách hàng.',
    pdf: peoplePdf(['Ngày hoàn', 'Khách hàng / người nhận', 'Số tiền', 'Bằng chữ', 'Lý do hoàn'], 'Ghi rõ chứng từ liên quan và phương thức hoàn tiền.'),
  },
  {
    id: 'customer-debt-reconciliation-blank',
    group: 'sales',
    name: 'Biên bản đối chiếu công nợ khách hàng',
    purpose: 'Đối chiếu các khoản phải thu, đã thu và số còn lại với khách hàng.',
    xlsx: { headers: RECON_HEADERS },
    pdf: reconcilePdf(['Khách hàng', 'Từ ngày', 'Đến ngày', 'Ngày đối chiếu']),
  },
  {
    id: 'customer-information-blank',
    group: 'sales',
    name: 'Mẫu khai báo thông tin khách hàng',
    purpose: 'Thu thập thông tin khách hàng bằng file văn phòng, không phải file nhập hàng loạt.',
    xlsx: { headers: ['Tên khách hàng', 'Tên giao dịch', 'Mã số thuế', 'Điện thoại', 'Email', 'Địa chỉ', 'Người liên hệ', 'Chức vụ', 'Điều khoản thanh toán đề nghị', 'Ghi chú'] },
  },

  {
    id: 'purchase-order-blank',
    group: 'purchasing',
    name: 'Mẫu đơn mua hàng',
    purpose: 'Lập yêu cầu mua hàng trống để trao đổi hoặc in ký.',
    xlsx: { headers: ITEM_HEADERS },
    pdf: itemPdf(['Nhà cung cấp', 'Ngày đặt hàng', 'Ngày cần hàng', 'Người phụ trách']),
  },
  {
    id: 'supplier-receipt-blank',
    group: 'purchasing',
    name: 'Mẫu phiếu nhận hàng Nhà cung cấp',
    purpose: 'Ghi nhận hàng nhận từ Nhà cung cấp bằng bản giấy.',
    pdf: itemPdf(['Ngày nhận', 'Nhà cung cấp', 'Kho nhận', 'Người nhận']),
  },
  {
    id: 'supplier-return-blank',
    group: 'purchasing',
    name: 'Mẫu phiếu trả hàng Nhà cung cấp',
    purpose: 'Ghi nhận hàng trả lại Nhà cung cấp và lý do trả.',
    pdf: itemPdf(['Ngày trả', 'Nhà cung cấp', 'Kho xuất', 'Lý do trả']),
  },
  {
    id: 'supplier-payment-blank',
    group: 'purchasing',
    name: 'Mẫu phiếu chi / thanh toán Nhà cung cấp',
    purpose: 'Phiếu trống ghi nhận khoản chi hoặc thanh toán cho Nhà cung cấp.',
    pdf: peoplePdf(['Ngày chi', 'Nhà cung cấp / người nhận', 'Số tiền', 'Bằng chữ', 'Nội dung chi'], 'Ghi rõ phương thức thanh toán và chứng từ liên quan.'),
  },
  {
    id: 'supplier-debt-reconciliation-blank',
    group: 'purchasing',
    name: 'Biên bản đối chiếu công nợ Nhà cung cấp',
    purpose: 'Đối chiếu các khoản phải trả, đã thanh toán và số còn lại.',
    xlsx: { headers: RECON_HEADERS },
    pdf: reconcilePdf(['Nhà cung cấp', 'Từ ngày', 'Đến ngày', 'Ngày đối chiếu']),
  },
  {
    id: 'supplier-information-blank',
    group: 'purchasing',
    name: 'Mẫu khai báo thông tin Nhà cung cấp',
    purpose: 'Thu thập hồ sơ Nhà cung cấp bằng file văn phòng, không phải file nhập hàng loạt.',
    xlsx: { headers: ['Tên Nhà cung cấp', 'Tên giao dịch', 'Mã số thuế', 'Điện thoại', 'Email', 'Địa chỉ', 'Người liên hệ', 'Chức vụ', 'Ngân hàng', 'Số tài khoản', 'Thời gian giao dự kiến', 'Ghi chú'] },
  },

  {
    id: 'warehouse-receipt-blank',
    group: 'inventory',
    name: 'Mẫu phiếu nhập kho',
    purpose: 'Phiếu trống ghi nhận hàng nhập kho bằng chứng từ giấy.',
    pdf: stockPdf(['Ngày nhập', 'Kho nhập', 'Nguồn hàng / bộ phận giao', 'Người lập']),
  },
  {
    id: 'inventory-issue-blank',
    group: 'inventory',
    name: 'Mẫu phiếu xuất kho',
    purpose: 'Phiếu trống ghi nhận xuất kho cho nhu cầu nội bộ hoặc nghiệp vụ kho.',
    pdf: stockPdf(['Ngày xuất', 'Kho xuất', 'Bộ phận / người nhận', 'Lý do xuất']),
  },
  {
    id: 'inventory-transfer-blank',
    group: 'inventory',
    name: 'Mẫu phiếu chuyển kho',
    purpose: 'Ghi nhận bàn giao hàng giữa kho nguồn và kho đích.',
    pdf: stockPdf(['Ngày chuyển', 'Kho nguồn', 'Kho đích', 'Người lập']),
  },
  {
    id: 'stocktake-blank',
    group: 'inventory',
    name: 'Mẫu phiếu kiểm kê',
    purpose: 'Biểu mẫu trống để kiểm đếm thực tế, không chứa SKU hay tồn hiện tại của hệ thống.',
    xlsx: { headers: ['STT', 'Mã hàng', 'Tên hàng', 'ĐVT', 'Vị trí', 'Lô', 'Số đếm thực tế', 'Ghi chú'] },
    pdf: stockPdf(['Ngày kiểm kê', 'Kho', 'Khu vực kiểm kê', 'Người phụ trách']),
  },
  {
    id: 'inventory-adjustment-blank',
    group: 'inventory',
    name: 'Mẫu phiếu điều chỉnh tồn',
    purpose: 'Biểu mẫu trống ghi đề nghị điều chỉnh số lượng tồn.',
    xlsx: { headers: ['STT', 'Mã hàng', 'Tên hàng', 'ĐVT', 'Vị trí', 'Lô', 'Số lượng trước', 'Số lượng đề nghị', 'Chênh lệch', 'Lý do'] },
    pdf: stockPdf(['Ngày đề nghị', 'Kho', 'Bộ phận đề nghị', 'Lý do chung']),
  },
  {
    id: 'picking-blank',
    group: 'inventory',
    name: 'Mẫu phiếu soạn hàng / cấp hàng',
    purpose: 'Phiếu trống hướng dẫn soạn hoặc cấp hàng khi cần làm việc bằng giấy.',
    pdf: stockPdf(['Ngày soạn', 'Kho', 'Bộ phận / khách nhận', 'Người phụ trách']),
  },

  {
    id: 'delivery-trip-blank',
    group: 'logistics',
    name: 'Mẫu phiếu chuyến giao hàng',
    purpose: 'Phiếu trống lập chuyến và danh sách điểm giao.',
    pdf: { meta: ['Ngày giao', 'Tài xế', 'Xe / biển số', 'Kho xuất'], columns: ['STT', 'Khách hàng', 'Địa chỉ', 'Số phiếu giao', 'Tiền COD', 'Ghi chú'], signatures: ['Điều phối', 'Tài xế', 'Người bàn giao'] },
  },
  {
    id: 'driver-handover-blank',
    group: 'logistics',
    name: 'Biên bản bàn giao hàng cho tài xế',
    purpose: 'Biên bản trống xác nhận số hàng và chứng từ giao cho tài xế.',
    pdf: { meta: ['Ngày bàn giao', 'Tài xế', 'Xe / biển số', 'Người bàn giao'], columns: ['STT', 'Chứng từ', 'Khách hàng', 'Số kiện', 'Nội dung', 'Ghi chú'], signatures: ['Người bàn giao', 'Tài xế nhận', 'Điều phối'] },
  },
  {
    id: 'cod-handover-blank',
    group: 'logistics',
    name: 'Biên bản bàn giao / thu tiền COD',
    purpose: 'Biên bản trống giao nhận tiền COD giữa tài xế và bộ phận nhận tiền.',
    pdf: { meta: ['Ngày bàn giao', 'Tài xế', 'Chuyến giao', 'Người nhận tiền'], columns: COD_HEADERS, signatures: ['Tài xế', 'Người nhận tiền', 'Kế toán / Quản lý'] },
  },
  {
    id: 'trip-reconciliation-blank',
    group: 'logistics',
    name: 'Biên bản đối soát chuyến',
    purpose: 'Đối chiếu kết quả giao hàng, hàng trả về và các khoản cần xử lý.',
    pdf: { meta: ['Ngày đối soát', 'Chuyến giao', 'Tài xế', 'Người đối soát'], columns: ['STT', 'Phiếu giao', 'Khách hàng', 'Kết quả giao', 'Hàng trả', 'COD', 'Ghi chú'], signatures: ['Điều phối', 'Tài xế', 'Kế toán / Kho'] },
  },
  {
    id: 'cod-reconciliation-blank',
    group: 'logistics',
    name: 'Biên bản đối soát COD',
    purpose: 'Đối chiếu tiền COD phải thu, đã thu và chênh lệch.',
    xlsx: { headers: COD_HEADERS },
    pdf: { meta: ['Từ ngày', 'Đến ngày', 'Tài xế / đơn vị', 'Ngày đối soát'], columns: COD_HEADERS, signatures: ['Người đối soát', 'Người bàn giao', 'Kế toán / Quản lý'] },
  },

  {
    id: 'leave-request-blank',
    group: 'workforce',
    name: 'Đơn xin nghỉ phép',
    purpose: 'Đơn giấy để nhân sự đề nghị nghỉ và xin phê duyệt.',
    pdf: peoplePdf(['Họ và tên', 'Mã nhân viên', 'Phòng/Bộ phận', 'Từ ngày', 'Đến ngày', 'Phần ngày', 'Lý do nghỉ'], 'Ghi rõ người bàn giao công việc khi cần.'),
  },
  {
    id: 'overtime-request-blank',
    group: 'workforce',
    name: 'Phiếu đăng ký tăng ca',
    purpose: 'Phiếu giấy đăng ký thời gian và lý do tăng ca.',
    pdf: peoplePdf(['Họ và tên', 'Mã nhân viên', 'Phòng/Bộ phận', 'Ngày tăng ca', 'Từ giờ', 'Đến giờ', 'Lý do']),
  },
  {
    id: 'attendance-adjustment-blank',
    group: 'workforce',
    name: 'Phiếu điều chỉnh chấm công',
    purpose: 'Phiếu giấy đề nghị sửa giờ vào, giờ ra hoặc tình trạng công.',
    pdf: peoplePdf(['Họ và tên', 'Mã nhân viên', 'Ngày công', 'Giờ đã ghi nhận', 'Giờ đề nghị điều chỉnh', 'Lý do']),
  },
  {
    id: 'blank-timesheet-month',
    group: 'workforce',
    name: 'Bảng chấm công tháng trống',
    purpose: 'Bảng Excel trống dùng ghi chấm công thủ công theo tháng.',
    xlsx: { headers: ['Ngày', 'Thứ', 'Giờ vào', 'Giờ ra', 'Ra ngoài', 'Quay lại', 'Tổng giờ', 'Nghỉ phép', 'Tăng ca', 'Ghi chú'], blankRows: 31 },
  },
  {
    id: 'blank-work-schedule-month',
    group: 'workforce',
    name: 'Lịch làm việc / phân ca tháng trống',
    purpose: 'Bảng Excel trống để lập lịch và phân ca theo tháng.',
    xlsx: { headers: ['Ngày', 'Thứ', 'Mã nhân viên', 'Họ và tên', 'Ca làm việc', 'Giờ bắt đầu', 'Giờ kết thúc', 'Nghỉ giữa ca', 'Ghi chú'], blankRows: 31 },
  },
  {
    id: 'attendance-violation-explanation-blank',
    group: 'workforce',
    name: 'Bản giải trình vi phạm chấm công',
    purpose: 'Biểu mẫu giấy để nhân sự giải trình sai lệch chấm công.',
    pdf: peoplePdf(['Họ và tên', 'Mã nhân viên', 'Ngày vi phạm', 'Nội dung ghi nhận', 'Nội dung giải trình'], 'Đính kèm chứng từ hoặc thông tin xác nhận nếu có.'),
  },
  {
    id: 'attendance-violation-record-blank',
    group: 'workforce',
    name: 'Biên bản xử lý vi phạm chấm công',
    purpose: 'Biên bản giấy ghi nhận kết luận xử lý vi phạm chấm công.',
    pdf: peoplePdf(['Họ và tên', 'Mã nhân viên', 'Ngày vi phạm', 'Nội dung vi phạm', 'Giải trình', 'Kết luận xử lý']),
  },
  {
    id: 'payroll-adjustments-blank',
    group: 'workforce',
    name: 'Bảng kê khoản lương bổ sung / khấu trừ',
    purpose: 'Bảng Excel trống tổng hợp khoản cộng thêm hoặc khấu trừ trước khi xử lý lương.',
    xlsx: { headers: ['STT', 'Mã nhân viên', 'Họ và tên', 'Loại khoản', 'Nội dung', 'Số tiền', 'Kỳ lương', 'Ghi chú'] },
  },
] as const;

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('vi-VN').trim();
}

function blankRows(count: number, columns: number) {
  return Array.from({ length: count }, () => Array.from({ length: columns }, () => ''));
}

function pdfId(formId: string) {
  return `office-form-${formId}`;
}

function pdfColumns(spec: PdfSpec): BusinessDocumentColumn[] {
  return (spec.columns ?? []).map((label, index) => ({
    key: `c${index}`,
    label,
    align: label === 'STT' || label.includes('Số lượng') || label.includes('Tiền') ? 'center' : 'left',
  }));
}

function pdfRows(spec: PdfSpec) {
  const columns = pdfColumns(spec);
  if (!columns.length) return [];
  return Array.from({ length: 8 }, (_value, rowIndex) => ({
    id: `blank-${rowIndex + 1}`,
    cells: Object.fromEntries(columns.map((column) => [column.key, column.key === 'c0' ? String(rowIndex + 1) : ''])),
  }));
}

export default function OfficeFormsLibrary() {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<OfficeFormGroup | 'all'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const visible = useMemo(() => {
    const term = normalize(query);
    return OFFICE_FORM_CATALOG.filter((form) => {
      if (group !== 'all' && form.group !== group) return false;
      if (!term) return true;
      return normalize(`${form.name} ${form.purpose} ${GROUP_LABELS[form.group]}`).includes(term);
    });
  }, [group, query]);

  async function downloadXlsx(form: OfficeForm) {
    if (!form.xlsx || busy) return;
    setBusy(form.id);
    setNotice('');
    try {
      const rows = blankRows(form.xlsx.blankRows ?? 12, form.xlsx.headers.length);
      await exportTable(
        `${form.id}.xlsx`,
        form.name.slice(0, 31),
        [...form.xlsx.headers],
        rows,
        'xlsx',
      );
      setNotice(`Đã tạo mẫu Excel trống: ${form.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Không tạo được mẫu Excel.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={styles.library} data-testid="office-forms-library">
      <div className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>Thư viện dùng ngoài hệ thống</p>
          <h2>Biểu mẫu văn phòng</h2>
          <p>Toàn bộ file dưới đây là mẫu trống, không chứa số liệu khách hàng, Nhà cung cấp, hàng hóa, tồn kho hay nhân sự hiện tại.</p>
        </div>
        <div className={styles.count}>{visible.length} / {OFFICE_FORM_CATALOG.length} biểu mẫu</div>
      </div>

      <div className={styles.distinction}>
        <strong>Phân biệt khi sử dụng</strong>
        <span><b>Xuất dữ liệu:</b> lấy số liệu thật theo màn đang xem.</span>
        <span><b>File mẫu nhập liệu:</b> dùng để nhập/cập nhật hàng loạt vào Công Ty.</span>
        <span><b>Biểu mẫu văn phòng:</b> file trống để điền, in, ký hoặc gửi ngoài hệ thống.</span>
      </div>

      <div className={styles.filters}>
        <label>
          <span>Tìm biểu mẫu</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ví dụ: đối chiếu công nợ, tăng ca, kiểm kê…" />
        </label>
        <label>
          <span>Nhóm nghiệp vụ</span>
          <select value={group} onChange={(event) => setGroup(event.target.value as OfficeFormGroup | 'all')}>
            <option value="all">Tất cả nhóm</option>
            {(Object.entries(GROUP_LABELS) as Array<[OfficeFormGroup, string]>).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </div>

      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

      <div className={styles.groups}>
        {(Object.entries(GROUP_LABELS) as Array<[OfficeFormGroup, string]>).map(([groupKey, groupLabel]) => {
          const forms = visible.filter((form) => form.group === groupKey);
          if (!forms.length) return null;
          return (
            <section key={groupKey} className={styles.group}>
              <div className={styles.groupHeader}><h3>{groupLabel}</h3><span>{forms.length} biểu mẫu</span></div>
              <div className={styles.grid}>
                {forms.map((form) => (
                  <article className={styles.card} key={form.id} data-testid={`office-form-${form.id}`}>
                    <div className={styles.cardHeader}>
                      <h4>{form.name}</h4>
                      <div className={styles.formats}>
                        {form.xlsx ? <span>XLSX</span> : null}
                        {form.pdf ? <span>PDF</span> : null}
                      </div>
                    </div>
                    <p>{form.purpose}</p>
                    <div className={styles.actions}>
                      {form.xlsx ? <button type="button" className={styles.downloadButton} disabled={busy !== null} onClick={() => void downloadXlsx(form)}>{busy === form.id ? 'Đang tạo…' : 'Tải Excel'}</button> : null}
                      {form.pdf ? <PrintAction targetId={pdfId(form.id)} label="In / lưu PDF" variant="text" /> : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {!visible.length ? <div className={styles.empty}>Không có biểu mẫu phù hợp với từ khóa và nhóm đã chọn.</div> : null}

      {OFFICE_FORM_CATALOG.filter((form) => form.pdf).map((form) => {
        const spec = form.pdf as PdfSpec;
        const columns = pdfColumns(spec);
        return (
          <BusinessDocumentPrint
            key={form.id}
            id={pdfId(form.id)}
            showAction={false}
            title={form.name}
            subtitle="Biểu mẫu văn phòng trống"
            headingFallback="HƯNG PHÁT"
            showNumber={false}
            number=""
            meta={spec.meta.map((label, index) => ({ key: `meta-${index}`, label, value: '................................................................' }))}
            columns={columns}
            rows={pdfRows(spec)}
            note={spec.note ?? 'Biểu mẫu trống — điền đầy đủ thông tin trước khi ký hoặc sử dụng.'}
            signatures={[...(spec.signatures ?? ['Người lập', 'Bộ phận liên quan', 'Người xác nhận'])]}
            size={spec.size ?? 'A4'}
            suppressBrowserHeaders
          />
        );
      })}
    </section>
  );
}
