import { NextRequest, NextResponse } from 'next/server';
import { getPayrollFoundation, normalizeWorkforceGatewayError, resolveWorkforceRequestId } from '../../../../../lib/workforce-gateway';
import { buildPayrollPayslipPdf } from '../../../../../lib/payroll-payslip-pdf.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ExportData = {
  selectedPeriod: { id: string; status: string } | null;
  capabilities: { canExport: boolean };
  closeout: {
    payslips: Array<{ employee_id: string; revision: number; snapshot: { employee: { code: string; name: string } } }>;
  };
};

function errorJson(code: string, message: string, status: number, requestId: string) {
  return NextResponse.json({ error: { code, message, retryable: false }, requestId }, { status, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } });
}

export async function GET(request: NextRequest) {
  const requestId = resolveWorkforceRequestId(request.headers.get('x-request-id'));
  const periodId = request.nextUrl.searchParams.get('periodId')?.trim() || '';
  const employeeId = request.nextUrl.searchParams.get('employeeId')?.trim() || '';
  if (!periodId || !employeeId) return errorJson('PAYROLL_PAYSLIP_REQUIRED', 'Vui lòng chọn phiếu lương cần xuất', 400, requestId);
  try {
    const data = await getPayrollFoundation<ExportData>(requestId, new URLSearchParams({ periodId }));
    if (!data.capabilities?.canExport) return errorJson('FORBIDDEN', 'Bạn không có quyền xuất phiếu lương', 403, requestId);
    if (data.selectedPeriod?.status !== 'CLOSED') return errorJson('PAYROLL_PERIOD_NOT_CLOSED', 'Chỉ xuất phiếu lương từ kỳ đã chốt', 409, requestId);
    const payslip = data.closeout?.payslips.find((item) => item.employee_id === employeeId);
    if (!payslip) return errorJson('PAYROLL_PAYSLIP_NOT_FOUND', 'Không tìm thấy phiếu lương nhân sự', 404, requestId);
    const file = buildPayrollPayslipPdf(payslip);
    const code = String(payslip.snapshot.employee.code || 'nhan-su').replace(/[^A-Za-z0-9._-]/g, '-');
    return new Response(new Uint8Array(file), {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Phieu-luong-${code}.pdf"`,
        'X-Content-Type-Options': 'nosniff',
        'x-request-id': requestId,
      },
    });
  } catch (error) {
    const normalized = normalizeWorkforceGatewayError(error);
    return NextResponse.json({ error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details }, requestId }, { status: normalized.statusCode, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } });
  }
}
