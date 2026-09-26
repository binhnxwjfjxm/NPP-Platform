import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');

test('Issue #1190 Lô 4 exports the locked master-data and workforce groups through the shared Excel foundation', () => {
  const actions = read('app/components/lot4-export-actions.tsx');
  const shared = read('app/components/operational-export-actions.tsx');
  for (const name of [
    'danh-sach-khach-hang.xlsx',
    'danh-sach-nha-cung-cap.xlsx',
    'danh-sach-nhan-vien.xlsx',
    'lich-su-cham-cong-hom-nay.xlsx',
    'bang-cong-thang.xlsx',
    'danh-sach-nghi-phep.xlsx',
    'danh-sach-tang-ca.xlsx',
    'xu-ly-vi-pham-cham-cong.xlsx',
    'ca-va-lich-lam-viec.xlsx',
  ]) assert.match(actions, new RegExp(name.replace('.', '\\.')));
  assert.match(shared, /loadSheets/);
  assert.doesNotMatch(actions, /installation_id|request_id|employee_id|warehouse_id|branch_id|policy_id_snapshot/);
});

test('Lô 4 puts filtered export actions on the customer, supplier and employee screens', () => {
  assert.match(read('app/customers/customer-workspace.tsx'), /CustomerListExportActions customers=\{visibleCustomers\}/);
  assert.match(read('app/suppliers/supplier-workspace.tsx'), /SupplierListExportActions suppliers=\{visibleSuppliers\}/);
  assert.match(read('app/workforce/employees/employee-workspace.tsx'), /EmployeeListExportActions employees=\{visibleEmployees\}/);
});

test('Lô 4 puts workforce exports on attendance, timesheet, leave, overtime, violation and schedule screens', () => {
  const pairs = [
    ['app/workforce/attendance/attendance-workspace.tsx', 'AttendanceTodayExportActions'],
    ['app/workforce/timesheet/attendance-timesheet-workspace.tsx', 'TimesheetExportActions'],
    ['app/workforce/leave/leave-workspace.tsx', 'LeaveExportActions'],
    ['app/workforce/overtime/overtime-closeout-workspace.tsx', 'OvertimeExportActions'],
    ['app/workforce/violations/attendance-violation-workspace.tsx', 'ViolationExportActions'],
    ['app/workforce/schedules/work-schedule-workspace.tsx', 'ScheduleExportActions'],
  ];
  for (const [path, symbol] of pairs) assert.match(read(path), new RegExp(symbol));
});

test('Lô 4 adds the locked import templates without inventing supplier or employee bulk import', () => {
  const customer = read('app/customers/customer-bulk-workspace.tsx');
  const opening = read('app/inventory/opening-balances/opening-balance-csv-workspace.tsx');
  const inbound = read('app/inventory/manual-inbounds/manual-inbound-workspace.tsx');
  assert.match(customer, /mau-nhap-khach-hang\.\$\{format\}/);
  assert.match(customer, /Tải mẫu Excel/);
  assert.match(customer, /Tải mẫu CSV/);
  assert.match(opening, /mau-ton-dau-ky\.\$\{format\}/);
  assert.match(opening, /Tải mẫu Excel/);
  assert.match(inbound, /mau-nhap-kho-thu-cong\.\$\{format\}/);
  assert.match(inbound, /Tải mẫu Excel/);
  assert.doesNotMatch(read('app/suppliers/supplier-workspace.tsx'), /Tải mẫu|bulk-import|bulk import/i);
  assert.doesNotMatch(read('app/workforce/employees/employee-workspace.tsx'), /Tải mẫu|bulk-import|bulk import/i);
});
