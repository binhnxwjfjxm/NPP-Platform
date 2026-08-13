import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';

const routeSource = readFileSync(new URL('../src/routes/logistics.js', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../src/services/logistics-driver-profile.js', import.meta.url), 'utf8');
const repositorySource = readFileSync(new URL('../src/db/repositories/logistics-driver-profile.js', import.meta.url), 'utf8');

test('G4 migration registers canonical employee FK without rewriting legacy rows', () => {
  const migration = CORE_API_MIGRATIONS.find(({ id }) => id === '076_logistics_driver_employee_integrity');
  assert.ok(migration);
  assert.match(migration.sql, /FOREIGN KEY \(installation_id, employee_id\)/);
  assert.match(migration.sql, /REFERENCES shared\.employees \(installation_id, id\)/);
  assert.match(migration.sql, /NOT VALID/);
  assert.match(migration.sql, /driver_profiles_employee_lookup_idx/);
});

test('G4 route and service require canonical employee-backed driver profiles', () => {
  assert.match(routeSource, /\/api\/logistics\/driver-employees/);
  assert.match(routeSource, /listDriverEmployees/);
  assert.match(routeSource, /createDriverProfile/);
  assert.match(serviceSource, /DRIVER_EMPLOYEE_NOT_AVAILABLE/);
  assert.match(serviceSource, /DRIVER_EMPLOYEE_ALREADY_LINKED/);
  assert.match(serviceSource, /pg_advisory_xact_lock/);
  assert.match(serviceSource, /getEmployeeByIdForInstallationForShare/);
  assert.match(serviceSource, /planDeliveryTripBase/);
  assert.match(serviceSource, /lockDeliveryTripBase/);
  assert.match(repositorySource, /NOT EXISTS/);
  assert.match(repositorySource, /employee\.is_active = true/);
});
