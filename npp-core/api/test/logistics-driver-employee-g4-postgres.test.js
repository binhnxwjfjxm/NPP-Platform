import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3084',
    INSTALLATION_ID: `logistics-driver-g4-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3007',
  };
}

function headers(config, key = null) {
  return {
    Authorization: `Bearer ${config.backendApiToken}`,
    'Content-Type': 'application/json',
    ...(key ? { 'Idempotency-Key': key } : {}),
  };
}

async function json(responseOrPromise) {
  const response = await responseOrPromise;
  const body = await response.json();
  return { response, body };
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test('G4 driver profile requires one active canonical employee and candidate list excludes linked staff', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  const actor = 'test:g4-driver';
  const activeEmployeeId = randomUUID();
  const inactiveEmployeeId = randomUUID();
  let server;

  try {
    await pool.query(
      `INSERT INTO shared.employees
        (id, installation_id, code, full_name, job_title, phone, is_active, created_by, updated_by)
       VALUES
        ($1,$2,'NV-G4-01','Nguyễn Tài Xế','Tài xế','0900000001',true,$3,$3),
        ($4,$2,'NV-G4-02','Nhân sự nghỉ','Tài xế','0900000002',false,$3,$3)`,
      [activeEmployeeId, config.installationId, actor, inactiveEmployeeId],
    );

    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;

    const candidatesBefore = await json(fetch(`${baseUrl}/api/logistics/driver-employees?limit=1000`, {
      headers: headers(config),
    }));
    assert.equal(candidatesBefore.response.status, 200, JSON.stringify(candidatesBefore.body));
    assert.equal(candidatesBefore.body.data.some((employee) => employee.id === activeEmployeeId), true);
    assert.equal(candidatesBefore.body.data.some((employee) => employee.id === inactiveEmployeeId), false);

    const missingEmployee = await json(fetch(`${baseUrl}/api/logistics/drivers`, {
      method: 'POST',
      headers: headers(config, `g4-missing-${randomUUID()}`),
      body: JSON.stringify({ code: 'BROWSER-CODE', name: 'Browser name' }),
    }));
    assert.equal(missingEmployee.response.status, 400, JSON.stringify(missingEmployee.body));
    assert.equal(missingEmployee.body.error.code, 'INVALID_DRIVER_PROFILE');

    const inactiveEmployee = await json(fetch(`${baseUrl}/api/logistics/drivers`, {
      method: 'POST',
      headers: headers(config, `g4-inactive-${randomUUID()}`),
      body: JSON.stringify({ employeeId: inactiveEmployeeId }),
    }));
    assert.equal(inactiveEmployee.response.status, 409, JSON.stringify(inactiveEmployee.body));
    assert.equal(inactiveEmployee.body.error.code, 'DRIVER_EMPLOYEE_NOT_AVAILABLE');

    const created = await json(fetch(`${baseUrl}/api/logistics/drivers`, {
      method: 'POST',
      headers: headers(config, `g4-create-${randomUUID()}`),
      body: JSON.stringify({
        employeeId: activeEmployeeId,
        code: 'BROWSER-MUST-NOT-WIN',
        name: 'Browser must not win',
        phone: '000',
        licenseReference: 'B2-G4',
      }),
    }));
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.data.employeeId, activeEmployeeId);
    assert.equal(created.body.data.code, 'NV-G4-01');
    assert.equal(created.body.data.name, 'Nguyễn Tài Xế');
    assert.equal(created.body.data.phone, '0900000001');
    assert.equal(created.body.data.licenseReference, 'B2-G4');

    const duplicate = await json(fetch(`${baseUrl}/api/logistics/drivers`, {
      method: 'POST',
      headers: headers(config, `g4-duplicate-${randomUUID()}`),
      body: JSON.stringify({ employeeId: activeEmployeeId }),
    }));
    assert.equal(duplicate.response.status, 409, JSON.stringify(duplicate.body));
    assert.equal(duplicate.body.error.code, 'DRIVER_EMPLOYEE_ALREADY_LINKED');

    const candidatesAfter = await json(fetch(`${baseUrl}/api/logistics/driver-employees?limit=1000`, {
      headers: headers(config),
    }));
    assert.equal(candidatesAfter.response.status, 200, JSON.stringify(candidatesAfter.body));
    assert.equal(candidatesAfter.body.data.some((employee) => employee.id === activeEmployeeId), false);

    const activeDrivers = await json(fetch(`${baseUrl}/api/logistics/drivers?active=true`, {
      headers: headers(config),
    }));
    assert.equal(activeDrivers.response.status, 200, JSON.stringify(activeDrivers.body));
    assert.equal(activeDrivers.body.data.some((driver) => driver.employeeId === activeEmployeeId), true);

    await pool.query(
      `UPDATE shared.employees
          SET is_active = false, updated_at = now(), updated_by = $3
        WHERE installation_id = $1 AND id = $2`,
      [config.installationId, activeEmployeeId, actor],
    );

    const driversAfterEmployeeDeactivation = await json(fetch(`${baseUrl}/api/logistics/drivers?active=true`, {
      headers: headers(config),
    }));
    assert.equal(driversAfterEmployeeDeactivation.response.status, 200, JSON.stringify(driversAfterEmployeeDeactivation.body));
    assert.equal(driversAfterEmployeeDeactivation.body.data.some((driver) => driver.employeeId === activeEmployeeId), false);
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});
