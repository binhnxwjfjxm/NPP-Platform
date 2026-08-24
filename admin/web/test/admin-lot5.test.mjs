import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const listPage = await readFile('app/approvals/page.tsx', 'utf8');
const detailPage = await readFile('app/approvals/[approvalId]/page.tsx', 'utf8');
const decisionDialog = await readFile('app/approvals/proposal-decision-dialog.tsx', 'utf8');
const data = await readFile('app/approvals/proposal-data.ts', 'utf8');
const actions = await readFile('app/approvals/actions.ts', 'utf8');

test('Lô 5 replaces proposal fixtures with real Công Ty API data', () => {
  assert.doesNotMatch(listPage, /approval-fixtures|approvalFixtures|Dữ liệu minh họa/);
  assert.doesNotMatch(detailPage, /approval-fixtures|approvalFixtures|Dữ liệu minh họa/);
  assert.match(listPage, /loadProposals\(\)/);
  assert.match(detailPage, /loadProposal\(params\.approvalId\)/);
  assert.match(data, /\/api\/management-proposals/);
});

test('Lô 5 decisions keep office language and canonical idempotency contract', () => {
  assert.match(detailPage, /import \{ createIdempotencyKey \} from '@npp\/contracts'/);
  assert.match(detailPage, /createIdempotencyKey\('admin-proposal-decision'\)/);
  assert.match(detailPage, /ProposalDecisionDialog/);
  assert.match(decisionDialog, /Xem xét đề xuất/);
  assert.match(decisionDialog, /label: 'Đồng ý'/);
  assert.match(decisionDialog, /label: 'Yêu cầu bổ sung'/);
  assert.match(decisionDialog, /label: 'Từ chối'/);
  assert.match(decisionDialog, /action=\{decideProposal\}/);
  assert.match(actions, /idempotencyKey/);
  assert.match(actions, /IDEMPOTENCY_KEY_PATTERN = \/\^\[A-Za-z0-9\._-\]\{1,128\}\$\//);
  assert.match(actions, /\/decision/);
  assert.doesNotMatch(actions, /createIdempotencyKey|randomUUID|Date\.now/);
});

test('Lô 5 does not hide source or permission failure behind fake zero proposal counts', () => {
  assert.match(listPage, /statusCode === 403/);
  assert.match(listPage, /Không thể tải danh sách đề xuất/);
  assert.match(detailPage, /statusCode === 403/);
  assert.match(detailPage, /Không thể tải đề xuất/);
  assert.doesNotMatch(listPage, /proposals \?\? \[\]/);
});
