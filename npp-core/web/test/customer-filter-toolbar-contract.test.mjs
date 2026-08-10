import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Lane D combines customer search, status, group and responsible employee filters', async () => {
  const workspace = await read('app/customers/customer-workspace.tsx');

  assert.match(workspace, /const \[statusFilter, setStatusFilter\]/);
  assert.match(workspace, /const \[groupFilter, setGroupFilter\]/);
  assert.match(workspace, /const \[employeeFilter, setEmployeeFilter\]/);
  assert.match(workspace, /data-testid="customers-search-input"/);
  assert.match(workspace, /data-testid="customers-status-filter"/);
  assert.match(workspace, /data-testid="customers-group-filter"/);
  assert.match(workspace, /data-testid="customers-employee-filter"/);
  assert.match(workspace, /employeeFilter === 'unassigned'/);
  assert.match(workspace, /customer\.responsible_employee_id === employeeFilter/);
  assert.match(workspace, /return statusMatches && groupMatches && employeeMatches && textMatches/);
});

test('Lane D builds employee choices only from the already-authorized customer list', async () => {
  const workspace = await read('app/customers/customer-workspace.tsx');

  assert.match(workspace, /const employeeFilterOptions = useMemo\(\(\) => \{/);
  assert.match(workspace, /for \(const customer of customers\)/);
  assert.match(workspace, /customer\.responsible_employee_id/);
  assert.match(workspace, /customer\.responsible_employee_name/);
  assert.match(workspace, /requestJson<Customer\[]>\('\/api\/customers\?limit=1000'\)/);
  assert.doesNotMatch(workspace, /responsibleEmployeeId=.*\/api\/customers/);
});

test('Lane D keeps the customer toolbar compact on desktop and responsive on smaller screens', async () => {
  const [workspace, css] = await Promise.all([
    read('app/customers/customer-workspace.tsx'),
    read('app/customers/customers.module.css'),
  ]);

  assert.match(workspace, /customerStyles\.toolbarSearchCompact/);
  assert.match(workspace, /customerStyles\.toolbarEmployeeCompact/);
  assert.match(css, /grid-template-columns:\s*minmax\(210px, 1\.25fr\)[^;]*minmax\(180px, 0\.9fr\)/s);
  assert.match(css, /\.toolbarGrid input,[\s\S]*min-height:\s*34px/);
  assert.match(css, /@media \(max-width: 1050px\)[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.toolbarEmployeeCompact/);
});
