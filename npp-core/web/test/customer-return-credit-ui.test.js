import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function webSource(relativePath) { return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8'); }
const page = webSource('app/accounting/customer-return-credits/page.tsx');
const workspace = webSource('app/accounting/customer-return-credits/customer-return-credit-workspace.tsx');
const gateway = webSource('lib/customer-return-credit-gateway.ts');
const collectionRoute = webSource('app/api/customer-return-credits/route.ts');
const allocationRoute = webSource('app/api/customer-return-credits/[id]/allocations/route.ts');
const creditReverseRoute = webSource('app/api/customer-return-credits/[id]/reverse/route.ts');
const refundRoute = webSource('app/api/customer-refunds/route.ts');
const refundReverseRoute = webSource('app/api/customer-refunds/[id]/reverse/route.ts');

test('return credit page explains received-return settlement without changing warehouse receipt', () => { assert.match(page, /title="Điều chỉnh công nợ hàng trả"/); assert.match(page, /Credit chỉ phát sinh khi kho đã nhận Customer Return/); assert.match(page, /CustomerReturnCreditWorkspace/); assert.doesNotMatch(page, /\bCOD\b|MCP|write[-_ ]?off/i); });
test('workspace supports allocation explicit refund and compensating reversal', () => { assert.match(workspace, /data-testid="customer-return-credit-workspace"/); assert.match(workspace, /data-testid="customer-return-credit-allocation-form"/); assert.match(workspace, /data-testid="customer-refund-form"/); assert.match(workspace, /Phân bổ credit/); assert.match(workspace, /Ghi nhận hoàn tiền/); assert.match(workspace, /Đảo hoàn tiền/); assert.match(workspace, /Đảo credit hàng trả/); assert.match(workspace, /destinationReference/); assert.match(workspace, /reversalReason/); assert.doesNotMatch(workspace, /auto.*refund|\bCOD\b|MCP|write[-_ ]?off/i); });
test('gateway keeps workforce sessions private and forwards idempotency keys', () => { assert.match(gateway, /import 'server-only'/); assert.match(gateway, /CORE_API_INTERNAL_URL/); assert.match(gateway, /requireNppWorkforceSessionToken/); assert.doesNotMatch(gateway, /process\.env\.CORE_API_SERVER_TOKEN/); assert.match(gateway, /'Idempotency-Key':\s*idempotencyKey/); assert.match(gateway, /\/api\/customer-return-credits\/\$\{uuid/); assert.match(gateway, /\/api\/customer-refunds\/\$\{uuid/); assert.doesNotMatch(gateway, /NEXT_PUBLIC_.*TOKEN/); });
test('web API surface exposes read allocate refund and reversals', () => { assert.match(collectionRoute, /listCustomerReturnCredits/); assert.match(allocationRoute, /allocateCustomerReturnCredit/); assert.match(creditReverseRoute, /reverseCustomerReturnCredit/); assert.match(refundRoute, /createCustomerRefund/); assert.match(refundReverseRoute, /reverseCustomerRefund/); for (const source of [allocationRoute, creditReverseRoute, refundRoute, refundReverseRoute]) { assert.match(source, /customerReturnCreditIdempotencyKey/); assert.match(source, /customerReturnCreditErrorResponse/); } });
