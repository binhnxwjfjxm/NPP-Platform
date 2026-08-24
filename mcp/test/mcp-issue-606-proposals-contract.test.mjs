import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const reportsPage = readFileSync(new URL('../src/app/reports/page.tsx', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../src/features/market-reports/ReportsModeTabs.tsx', import.meta.url), 'utf8');
const proposalPage = readFileSync(new URL('../src/features/management-proposals/McpProposalsPage.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../apps/backend/foundation/management-proposal-api.js', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../apps/backend/foundation/core-management-proposals.js', import.meta.url), 'utf8');

test('Issue 606 Lô A keeps MCP proposal flow inside Báo cáo with two explicit modes', () => {
  assert.match(reportsPage, /view === "proposals"/);
  assert.match(tabs, />\s*Đề xuất\s*</);
  assert.match(tabs, />\s*Báo cáo\s*</);
  assert.match(proposalPage, /Nội dung đề xuất/);
  assert.match(proposalPage, /Đề xuất của tôi/);
});

test('MCP proposal form requires only title/content and collapses supporting details', () => {
  assert.match(proposalPage, /name="title"[^>]*required/);
  assert.match(proposalPage, /name="content"[^>]*required/);
  assert.match(proposalPage, /Thêm thông tin liên quan/);
  assert.doesNotMatch(proposalPage, /name="entityId"[^>]*required/);
  assert.doesNotMatch(proposalPage, /name="entityLabel"[^>]*required/);
  assert.doesNotMatch(proposalPage, /name="impact"[^>]*required/);
  assert.doesNotMatch(proposalPage, /name="reason"[^>]*required/);
  assert.doesNotMatch(proposalPage, /name="rule"[^>]*required/);
  assert.match(proposalPage, /message === "Đã xảy ra lỗi nội bộ\."/);
});

test('MCP browser mutations use the shared idempotent fetch helper and backend permission gate', () => {
  assert.match(proposalPage, /idempotentMutationFetch/);
  assert.match(proposalPage, /operation: "mcp-management-proposal"/);
  assert.match(api, /authorizeCommand\(context, \{ permission: REPORT_PERMISSION \}\)/);
  assert.match(api, /idempotencyKey: context\.idempotencyKey/);
});

test('MCP bridge returns decision state through the Company proposal API using trusted employee identity', () => {
  assert.match(bridge, /\?source=mcp/);
  assert.match(bridge, /X-NPP-MCP-Employee-Id/);
  assert.match(bridge, /source: 'mcp', domain: 'mcp'/);
  assert.match(bridge, /UPSTREAM_UNAVAILABLE/);
  assert.match(bridge, /UPSTREAM_TIMEOUT/);
  assert.doesNotMatch(bridge, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:shared|sales|accounting|inventory)\./i);
});
