import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';

const migration109 = readFileSync(new URL('../../../database/migrations/shared/109_management_proposal_source_roundtrip.sql', import.meta.url), 'utf8');
const migration110 = readFileSync(new URL('../../../database/migrations/shared/110_management_proposal_optional_details.sql', import.meta.url), 'utf8');
const route = readFileSync(new URL('../src/routes/management-proposals.js', import.meta.url), 'utf8');
const permissions = readFileSync(new URL('../src/access/permissions.js', import.meta.url), 'utf8');
const companyGateway = readFileSync(new URL('../../web/lib/management-proposal-gateway.ts', import.meta.url), 'utf8');
const companyPage = readFileSync(new URL('../../web/app/management/proposals/page.tsx', import.meta.url), 'utf8');
const companyForm = readFileSync(new URL('../../web/app/management/proposals/proposal-forms.tsx', import.meta.url), 'utf8');
const companyActions = readFileSync(new URL('../../web/app/management/proposals/actions.ts', import.meta.url), 'utf8');
const adminList = readFileSync(new URL('../../../admin/web/app/approvals/page.tsx', import.meta.url), 'utf8');
const adminData = readFileSync(new URL('../../../admin/web/app/approvals/proposal-data.ts', import.meta.url), 'utf8');
const adminDetail = readFileSync(new URL('../../../admin/web/app/approvals/[approvalId]/page.tsx', import.meta.url), 'utf8');

test('proposal migrations keep source round-trip and make optional details explicit in 110', () => {
  const migrationIds = CORE_API_MIGRATIONS.map((entry) => entry.id);
  const sourceRoundTripIndex = migrationIds.indexOf('109_management_proposal_source_roundtrip');
  const optionalDetailsIndex = migrationIds.indexOf('110_management_proposal_optional_details');
  assert.ok(sourceRoundTripIndex >= 0);
  assert.equal(optionalDetailsIndex, sourceRoundTripIndex + 1);
  assert.match(migration109, /ADD COLUMN IF NOT EXISTS content text/);
  assert.match(migration109, /core\.management-proposal\.submit/);
  assert.match(migration110, /ALTER COLUMN entity_id SET DEFAULT ''/);
  assert.match(migration110, /ALTER COLUMN impact SET DEFAULT ''/);
  assert.match(migration110, /CHECK \(length\(btrim\(reason\)\) <= 4000\)/);
  assert.match(permissions, /coreManagementProposalSubmit: 'core\.management-proposal\.submit'/);
  assert.match(route, /content: text\(payload\?\.content, 4000\)/);
  assert.match(route, /content, entity_type/);
});

test('source read is deny-by-default and scoped back to the originating employee or actor', () => {
  assert.match(route, /function ownsProposal\(context, row\)/);
  assert.match(route, /requester_employee_id/);
  assert.match(route, /requester_actor_id/);
  assert.match(route, /source = ANY\(\$5::text\[\]\)/);
  assert.match(route, /COMPANY_SUBMIT_PERMISSION/);
  assert.match(route, /MCP_SUBMIT_PERMISSION/);
  assert.doesNotMatch(route, /if \(method === 'GET'\) \{\s*if \(!canManage\(context\)\)/);
});

test('create, decision and resubmit stay on canonical idempotency plus audit/outbox lifecycle', () => {
  assert.match(route, /executeRequestWithIdempotency/);
  assert.match(route, /withAuditOutboxTransaction/);
  assert.match(route, /management\.proposal\.submitted/);
  assert.match(route, /management\.proposal\.decision-recorded/);
  assert.match(route, /management\.proposal\.resubmitted/);
  assert.match(route, /DECISIONS = new Set\(\['approved', 'needs-info', 'rejected'\]\)/);
  assert.equal((route.match(/expectedOutboxCount:\s*1/g) ?? []).length, 3);
  assert.equal((route.match(/return transactionResult\.proposal;/g) ?? []).length, 3);
});

test('proposal create requires only title/content while optional metadata remains bounded', () => {
  assert.match(route, /function optionalText\(value, max = 1000\)/);
  assert.match(route, /entityId: optionalText\(payload\?\.entityId, 240\)/);
  assert.match(route, /entityLabel: optionalText\(payload\?\.entityLabel, 240\)/);
  assert.match(route, /impact: optionalText\(payload\?\.impact, 1000\)/);
  assert.match(route, /reason: optionalText\(payload\?\.reason, 4000\)/);
  assert.match(route, /rule: optionalText\(payload\?\.rule, 1000\)/);
  assert.match(route, /!result\.title \|\| !result\.content/);
  assert.doesNotMatch(route, /!result\.entityId \|\| !result\.entityLabel/);
  assert.match(route, /const nextReason = optionalText\(payload\?\.reason, 4000\)/);
});

test('Công Ty form keeps only title/content mandatory and returns submission errors inline', () => {
  assert.match(companyGateway, /createIdempotencyKey/);
  assert.match(companyGateway, /normalizeIdempotencyKey/);
  assert.match(companyGateway, /source: 'company'/);
  assert.match(companyGateway, /\?source=company/);
  assert.match(companyPage, /ManagementProposalForm/);
  assert.match(companyForm, /name="title" required/);
  assert.match(companyForm, /name="content" required/);
  assert.match(companyForm, /Thêm thông tin liên quan/);
  assert.doesNotMatch(companyForm, /name="entityId" required/);
  assert.doesNotMatch(companyForm, /name="entityLabel" required/);
  assert.doesNotMatch(companyForm, /name="impact"[^>]*required/);
  assert.doesNotMatch(companyForm, /name="reason"[^>]*required/);
  assert.doesNotMatch(companyForm, /name="rule"[^>]*required/);
  assert.match(companyActions, /ManagementProposalGatewayError/);
  assert.match(companyActions, /Nội dung vừa nhập vẫn được giữ/);
  assert.match(companyForm, /role="alert"/);
});

test('Admin tolerates proposals without optional related-object metadata', () => {
  assert.match(adminData, /content: string/);
  assert.match(adminData, /typeof row\.content === 'string'/);
  assert.match(adminList, /item\.entityLabel \?/);
  assert.match(adminList, /item\.impact \?/);
  assert.match(adminDetail, /const hasRelatedEntity = Boolean/);
  assert.match(adminDetail, /hasRelatedEntity \?/);
  assert.match(adminDetail, /item\.reason \?/);
  assert.match(adminDetail, /item\.rule \?/);
  assert.match(adminDetail, /item\.evidence\.length \?/);
});
