function ascii(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ĐÐ]/g, 'D')
    .replace(/đ/g, 'd')
    .replace(/[^ -~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function esc(value) {
  return ascii(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
function money(value) {
  const raw = String(value ?? '0.00');
  const [wholeRaw, fractionRaw = ''] = raw.split('.');
  const negative = wholeRaw.startsWith('-');
  const digits = negative ? wholeRaw.slice(1) : wholeRaw;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = fractionRaw.replace(/0+$/, '');
  return `${negative ? '-' : ''}${grouped}${fraction ? ',' + fraction : ''} VND`;
}
function textOp(value, x, y, size = 10, bold = false) {
  return `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${esc(value)}) Tj ET\n`;
}
export function buildPayrollPayslipPdf(payslip) {
  const s = payslip?.snapshot ?? {};
  const pay = s.pay ?? {};
  const employee = s.employee ?? {};
  const period = s.period ?? {};
  const lines = [];
  lines.push(textOp('PHIEU LUONG', 48, 790, 18, true));
  lines.push(textOp(`Nhan su: ${employee.code || ''} - ${employee.name || ''}`, 48, 758, 11, true));
  lines.push(textOp(`Ky luong: ${period.from || ''} den ${period.to || ''}`, 48, 738, 10));
  lines.push(textOp(`Chi nhanh: ${employee.branchName || 'Toan Cong Ty'}`, 48, 720, 10));
  const rows = [
    ['Luong theo cong', money(pay.salaryAmount)],
    ['Thu nhap them', money(pay.incomeTotal)],
    ['Hoan chi phi', money(pay.reimbursementTotal)],
    ['Khau tru', money(pay.deductionTotal)],
    ['Tong thu nhap', money(pay.grossIncome)],
    ['THUC NHAN', money(pay.netPay)],
  ];
  let y = 680;
  for (const [label, value] of rows) {
    lines.push(textOp(label, 58, y, 10, label === 'THUC NHAN'));
    lines.push(textOp(value, 330, y, 10, label === 'THUC NHAN'));
    y -= 28;
  }
  const adjustments = Array.isArray(s.adjustments) ? s.adjustments : [];
  if (adjustments.length) {
    lines.push(textOp('Dieu chinh sau chot', 48, y - 8, 11, true));
    y -= 34;
    for (const item of adjustments.slice(-8)) {
      lines.push(textOp(`${item.direction === 'REVERSE' ? 'Giam' : 'Them'} - ${item.name}: ${money(item.amount)}`, 58, y, 9));
      y -= 16;
      lines.push(textOp(`Ly do: ${item.reason}`, 68, y, 8));
      y -= 22;
    }
  }
  lines.push(textOp(`Phien ban phieu: ${payslip.revision || 1}`, 48, 56, 8));
  const stream = lines.join('');
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [5 0 R] /Count 1 >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
  objects[5] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents 6 0 R >>';
  objects[6] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`;
  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = Buffer.byteLength(out, 'latin1');
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i += 1) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
