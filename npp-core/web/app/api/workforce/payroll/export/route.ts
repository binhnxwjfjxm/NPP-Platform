import { NextRequest, NextResponse } from 'next/server';
import { getPayrollFoundation, normalizeWorkforceGatewayError, resolveWorkforceRequestId } from '../../../../../lib/workforce-gateway';
import { TABULAR_XLSX_MIME, createTabularXlsx } from '../../../../../lib/tabular-xlsx.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ExportData = {
  selectedPeriod: { id: string; status: string } | null;
  capabilities: { canExport: boolean };
  closeout: {
    closeSnapshot: { snapshot: { period: { from: string; to: string } } } | null;
    payslips: Array<{
      revision: number;
      snapshot: {
        employee: { code: string; name: string; branchName?: string | null };
        pay: {
          salaryAmount: string;
          incomeTotal: string;
          reimbursementTotal: string;
          deductionTotal: string;
          grossIncome: string;
          netPay: string;
          payableWorkDays: number;
          standardWorkDays: number;
          confirmedOvertimeMinutes: number;
        };
      };
    }>;
  };
};

function errorJson(code: string, message: string, status: number, requestId: string) {
  return NextResponse.json({ error: { code, message, retryable: false }, requestId }, { status, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } });
}

export async function GET(request: NextRequest) {
  const requestId = resolveWorkforceRequestId(request.headers.get('x-request-id'));
  const periodId = request.nextUrl.searchParams.get('periodId')?.trim() || '';
  if (!periodId) return errorJson('PAYROLL_PERIOD_REQUIRED', 'Vui lòng chọn kỳ lương cần xuất', 400, requestId);
  try {
    const data = await getPayrollFoundation<ExportData>(requestId, new URLSearchParams({ periodId }));
    if (!data.capabilities?.canExport) return errorJson('FORBIDDEN', 'Bạn không có quyền xuất bảng lương', 403, requestId);
    if (data.selectedPeriod?.status !== 'CLOSED' || !data.closeout?.closeSnapshot) {
      return errorJson('PAYROLL_PERIOD_NOT_CLOSED', 'Chỉ xuất bảng lương từ kỳ đã chốt', 409, requestId);
    }
    const headers = ['Mã nhân sự', 'Họ tên', 'Chi nhánh', 'Công được tính', 'Công chuẩn', 'Giờ tăng ca xác nhận', 'Lương theo công', 'Thu nhập thêm', 'Hoàn chi phí', 'Khấu trừ', 'Tổng thu nhập', 'Thực nhận', 'Phiên bản phiếu'];
    const rows = data.closeout.payslips.map((item) => {
      const pay = item.snapshot.pay;
      return [
        item.snapshot.employee.code,
        item.snapshot.employee.name,
        item.snapshot.employee.branchName || 'Toàn Công Ty',
        String(pay.payableWorkDays),
        String(pay.standardWorkDays),
        String(Number(pay.confirmedOvertimeMinutes ?? 0) / 60),
        pay.salaryAmount,
        pay.incomeTotal,
        pay.reimbursementTotal,
        pay.deductionTotal,
        pay.grossIncome,
        pay.netPay,
        String(item.revision),
      ];
    });
    const workbook = createTabularXlsx({ sheetName: 'Bảng lương đã chốt', headers, rows });
    const from = data.closeout.closeSnapshot.snapshot.period.from;
    const to = data.closeout.closeSnapshot.snapshot.period.to;
    return new Response(new Uint8Array(workbook), {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Content-Type': TABULAR_XLSX_MIME,
        'Content-Disposition': `attachment; filename="Bang-luong-${from}-den-${to}.xlsx"`,
        'X-Content-Type-Options': 'nosniff',
        'x-request-id': requestId,
      },
    });
  } catch (error) {
    const normalized = normalizeWorkforceGatewayError(error);
    return NextResponse.json({ error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details }, requestId }, { status: normalized.statusCode, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } });
  }
}
