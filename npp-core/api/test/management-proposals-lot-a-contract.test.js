import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';

const migration = readFileSync(new URL('../../../database/migrations/shared/109_management_proposal_source_roundtrip.sql', import.meta.url), 'utf8');
const route = readFileSync(new URL('../src/routes/management-proposals.js', import.meta.url), 'utf8');
const permissions = readFileSync(new URL('../src/access/permissions.js', import.meta.url), 'utf8');
const companyGateway = readFileSync(new URL('../../web/lib/management-proposal-gateway.ts', import.meta.url), 'utf8');
const companyPage = readFileSync(new URL('../../web/app/management/proposals/page.tsx', import.meta.url), 'utf8');
const adminData = readFileSync(new URL('../../../admin/web/app/approvals/proposal-data.ts', import.meta.url), 'utf8');
const adminDetail = readFileSync(new URL('../../../admin/web/app/approvals/[approvalId]/page.tsx', import.meta.url), 'utf8');

test('Lô A extends the shared proposal contract with manual content and Company permission', () => {
  assert.equal(CORE_API_MIGRATIONS.at(-1)?.id, '109_management_proposal_source_roundtrip');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS content text/);
  assert.match(migration, /core\.management-proposal\.submit/);
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
});

test('Công Ty form uses the canonical API contract and shows returned Admin decision state', () => {
  assert.match(companyGateway, /createIdempotencyKey/);
  assert.match(companyGateway, /normalizeIdempotencyKey/);
  assert.match(companyGateway, /source: 'company'/);
  assert.match(companyGateway, /\?source=company/);
  assert.match(companyPage, /Nội dung đề xuất/);
  assert.match(companyPage, /Phản hồi Admin/);
  assert.match(companyPage, /needs-info/);
});

test('Admin reads the new manual content and the selected related-object fields', () => {
  assert.match(adminData, /content: string/);
  assert.match(adminData, /typeof row\.content === 'string'/);
  assert.match(adminDetail, /Nội dung đề xuất/);
  assert.match(adminDetail, /Đối tượng liên quan/);
  assert.match(adminDetail, /item\.entityId/);
  assert.match(adminDetail, /item\.content/);
});
