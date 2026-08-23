import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';

const migration = readFileSync(new URL('../../../database/migrations/shared/108_management_proposals.sql', import.meta.url), 'utf8');
const route = readFileSync(new URL('../src/routes/management-proposals.js', import.meta.url), 'utf8');
const reporting = readFileSync(new URL('../src/routes/reporting-sales-purchasing.js', import.meta.url), 'utf8');

test('Lô 5 registers proposal foundation without occupying 107', () => {
  const ids = CORE_API_MIGRATIONS.map((entry) => entry.id);
  assert.ok(ids.includes('106_business_purge_document_number_allocations'));
  assert.equal(ids.includes('107_management_proposals'), false);
  assert.ok(ids.includes('108_management_proposals'));
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.management_proposals/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.management_proposal_events/);
  assert.match(migration, /status text NOT NULL DEFAULT 'pending'/);
  assert.match(migration, /'needs-info'/);
  assert.match(migration, /'approved'/);
  assert.match(migration, /'rejected'/);
});

test('Lô 5 exposes the real proposal lifecycle through the Công Ty API boundary', () => {
  assert.match(reporting, /handleManagementProposalRoutes/);
  assert.match(route, /const ROOT = '\/api\/management-proposals'/);
  assert.match(route, /target\.kind === 'decision'/);
  assert.match(route, /target\.kind === 'resubmit'/);
  assert.match(route, /executeRequestWithIdempotency/);
  assert.match(route, /withAuditOutboxTransaction/);
  assert.match(route, /management\.proposal\.submitted/);
  assert.match(route, /management\.proposal\.decision-recorded/);
  assert.match(route, /management\.proposal\.resubmitted/);
});

test('Admin decision records a decision only; the originating domain remains responsible for execution', () => {
  assert.match(route, /DECISIONS = new Set\(\['approved', 'needs-info', 'rejected'\]\)/);
  assert.match(route, /shared\.management_proposals/);
  assert.match(route, /shared\.management_proposal_events/);
  assert.doesNotMatch(route, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:sales|accounting|inventory)\./i);
  assert.match(route, /eventType: 'management\.proposal\.decision-recorded'/);
});
