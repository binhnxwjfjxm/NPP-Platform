import test from 'node:test';
import assert from 'node:assert/strict';
import { listUsers } from '../src/services/access-users.js';

const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const BRANCH_ID = '33333333-3333-4333-8333-333333333333';
const WAREHOUSE_ID = '44444444-4444-4444-8444-444444444444';

test('access user list exposes canonical branch/warehouse assignments and owner kind', async () => {
  let capturedSql = '';
  const client = {
    async query(sql) {
      capturedSql = sql;
      return {
        rows: [{
          id: USER_ID,
          installation_id: INSTALLATION_ID,
          employee_id: null,
          employee_code: 'NV01',
          employee_full_name: 'Nguyen Van A',
          login_name: 'nv.a',
          is_active: true,
          created_at: '2026-08-14T00:00:00.000Z',
          updated_at: '2026-08-14T00:00:00.000Z',
          created_by: 'test',
          updated_by: 'test',
          role_ids: [],
          branch_ids: [BRANCH_ID],
          warehouse_ids: [WAREHOUSE_ID],
          owner_kind: null,
        }],
      };
    },
  };

  const result = await listUsers(client, {
    installationId: INSTALLATION_ID,
    active: undefined,
    search: '',
    limit: 1000,
    offset: 0,
  });

  assert.deepEqual(result.users[0].branch_ids, [BRANCH_ID]);
  assert.deepEqual(result.users[0].warehouse_ids, [WAREHOUSE_ID]);
  assert.equal(result.users[0].owner_kind, null);
  assert.match(capturedSql, /shared\.user_scopes/);
  assert.match(capturedSql, /shared\.security_owner_bindings/);
  assert.match(capturedSql, /us\.scope_type = 'WAREHOUSE'/);
});
