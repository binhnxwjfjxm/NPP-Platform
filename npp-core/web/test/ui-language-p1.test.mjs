import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const appShell = read('app/components/app-shell-core.tsx');
const login = read('app/login/page.tsx');
const management = read('app/management/page.tsx');
const onboardingPage = read('app/management/customer-onboarding/page.tsx');
const onboardingReview = read('app/management/customer-onboarding/customer-onboarding-review.tsx');
const rolePresets = read('app/access/roles/role-presets.ts');
const employeePerformance = read('app/components/employee-mcp-reporting-workspace.tsx');
const salesOrders = read('app/sales/sales-orders/SalesOrderWorkspace.tsx');
const commercialForm = read('app/sales/sales-orders/SalesOrderCommercialForm.tsx');
const pricing = read('app/pricing/pricing-workspace.tsx');
const purchaseWorkspace = read('app/purchasing/purchase-orders/PurchaseOrderWorkspace.tsx');
const purchaseEditor = read('app/purchasing/purchase-orders/components/PurchaseOrderEditorV4.tsx');
const purchasePrint = read('app/purchasing/purchase-orders/PurchaseOrderPrintSheet.tsx');
const inventory = read('app/inventory/inventory-scoped-workspace.tsx');
const businessPrint = read('app/components/business-document-print.tsx');
const customerMedia = read('app/customers/customer-media-dialog.tsx');
const middleware = read('middleware.ts');
const internalAuth = read('lib/internal-auth-client.ts');
const userScopesRoute = read('app/api/access/users/[id]/scopes/route.ts');
const userCredentialRoute = read('app/api/access/users/[id]/credential/route.ts');
const language = read('lib/business-language.ts');

const userFacing = [
  appShell,
  login,
  management,
  onboardingPage,
  onboardingReview,
  rolePresets,
  employeePerformance,
  salesOrders,
  commercialForm,
  pricing,
  purchaseWorkspace,
  purchaseEditor,
  purchasePrint,
  inventory,
  businessPrint,
  customerMedia,
  middleware,
  internalAuth,
  userScopesRoute,
  userCredentialRoute,
].join('\n');

test('P1 business language uses Công Ty for company-facing NPP/Core wording', () => {
  assert.match(login, /Hệ thống điều hành Công Ty/);
  assert.match(appShell, /<small>Công Ty<\/small>/);
  assert.match(employeePerformance, /Đơn Công Ty/);
  assert.match(onboardingPage, /Bộ phận bán hàng/);
  assert.match(onboardingPage, /Hệ thống Công Ty/);
  assert.match(onboardingReview, /mã khách Công Ty/);
  assert.match(businessPrint, /Bản in từ Hệ thống Công Ty/);
  assert.match(customerMedia, /MCP Thị trường và Công Ty/);
  assert.match(customerMedia, /Nguồn: Công Ty/);
  assert.doesNotMatch(userFacing, /Hệ thống điều hành NPP|NPP Operations|NPP Core|Hưng Phát Company|Đơn Core|Khách hàng Core|Giá Core|Sales Admin|Nguồn: Core|MCP hiện trường|mã khách trên Core|chứng từ canonical/);
});

test('P1 sales and field reporting map technical sources and labels before rendering', () => {
  assert.match(language, /salesOrderSourceLabel/);
  assert.match(language, /Nhân viên thị trường/);
  assert.match(language, /Khách hàng/);
  assert.match(salesOrders, /salesOrderSourceLabel\(order\.sourceType, order\.sourceId\)/);
  assert.match(management, /salesOrderSourceLabel\(order\.sourceType, order\.sourceId\)/);
  assert.doesNotMatch(management, /Sales Admin|CS và kế toán|Admin/);
  assert.doesNotMatch(employeePerformance, /MCP canonical|Field actor|Order intent|Admin control/);
});

test('P1 pricing never falls back to raw resolution reasons or BASE jargon', () => {
  assert.match(language, /pricingResolutionReasonLabel/);
  assert.match(pricing, /Chi tiết hình thành giá/);
  assert.match(commercialForm, /Giá điều chỉnh thủ công/);
  assert.doesNotMatch(pricing + commercialForm, /Dấu vết giá đã khóa|Giá ngoại lệ|Giá nền · BASE/);
  assert.doesNotMatch(pricing, /reason \|\| reason/);
  assert.doesNotMatch(commercialForm, /step\.reason \? ` · \$\{step\.reason\}`/);
});

test('P1 purchasing uses Đơn mua hàng and full nhà cung cấp wording', () => {
  const purchasing = [purchaseWorkspace, purchaseEditor, purchasePrint, appShell].join('\n');
  assert.match(purchaseWorkspace, /title="Đơn mua hàng"/);
  assert.match(purchasePrint, /title="ĐƠN MUA HÀNG"/);
  assert.doesNotMatch(purchasing, /Đơn đặt hàng|Tham chiếu NCC|Dùng giá NCC|Giá nhập tay|Lý do nhập tay giá/);
});

test('P1 inventory hides technical version from the normal policy table and uses canonical idempotency', () => {
  assert.match(inventory, /Tham chiếu nhà cung cấp/);
  assert.doesNotMatch(inventory, /<th>Phiên bản<\/th>/);
  assert.match(inventory, /createIdempotencyKey\('inventory-policy-save'\)/);
  assert.doesNotMatch(inventory, /policy-\$\{policyDraft\.baseVariantId\}-\$\{Date\.now\(\)\}/);
});

test('P1 mutations use shared canonical idempotency generators and reuse the cached onboarding key on retry', () => {
  assert.match(purchaseWorkspace, /createIdempotencyKey\(`purchase-order-\$\{action\}`\)/);
  assert.match(purchaseEditor, /createIdempotencyKey\('purchase-order-save'\)/);
  assert.match(onboardingReview, /import \{ createIdempotencyKey \} from '@npp\/contracts'/);
  assert.match(onboardingReview, /actionKeys\.current\[cacheKey\] \|\| createIdempotencyKey\('customer-onboarding-action'\)/);
  assert.doesNotMatch(onboardingReview, /function createIdempotencyKey\(/);
  assert.doesNotMatch(purchaseWorkspace, /`po-\$\{action\}-\$\{crypto\.randomUUID\(\)\}`/);
});
