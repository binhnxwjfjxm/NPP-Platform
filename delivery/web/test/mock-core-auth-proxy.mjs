import http from 'node:http';

const employeeId = '10000000-0000-4000-8000-000000000001';
const loginName = 'driver-a';
const password = 'delivery-test-password';
const fullName = 'Nguyễn Văn Tài';
const legacyToken = 'delivery-core-test-token-000000';
const sessionToken = 'nppusr.10000000-0000-4000-8000-000000000099.deliverytestsessiontoken00000000000000000000';

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function authenticated(req) {
  return req.headers.authorization === `Bearer ${sessionToken}`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:4011');

  if (req.method === 'POST' && url.pathname === '/api/internal-auth/login') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    if (body.loginName !== loginName || body.password !== password) {
      json(res, 401, { error: { code: 'INTERNAL_AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials' } });
      return;
    }
    json(res, 200, {
      data: {
        token: sessionToken,
        session: {
          id: '10000000-0000-4000-8000-000000000099',
          createdAt: '2026-08-09T00:00:00.000Z',
          expiresAt: '2027-08-09T00:00:00.000Z',
          sourceApp: body.sourceApp || 'delivery-web',
          accessChannel: 'WEB',
        },
        user: {
          id: '10000000-0000-4000-8000-000000000098',
          loginName,
          employeeId,
          employeeFullName: fullName,
          roles: ['delivery-driver'],
          permissions: ['logistics.driver.delivery.read'],
          scopes: { branchIds: [], warehouseIds: ['20000000-0000-4000-8000-000000000001'], territoryIds: [] },
          ownerKind: null,
        },
      },
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/internal-auth/me') {
    if (!authenticated(req)) {
      json(res, 401, { error: { code: 'UNAUTHORIZED' } });
      return;
    }
    json(res, 200, {
      data: {
        actorId: 'user:10000000-0000-4000-8000-000000000098',
        employeeId,
        roles: ['delivery-driver'],
        permissions: ['logistics.driver.delivery.read'],
        scopes: { branchIds: [], warehouseIds: ['20000000-0000-4000-8000-000000000001'], territoryIds: [] },
        sourceApp: 'delivery-web',
        session: {
          id: '10000000-0000-4000-8000-000000000099',
          userId: '10000000-0000-4000-8000-000000000098',
          loginName,
          employeeFullName: fullName,
          expiresAt: '2027-08-09T00:00:00.000Z',
          sourceApp: 'delivery-web',
          ownerKind: null,
        },
      },
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/internal-auth/logout') {
    if (!authenticated(req)) {
      json(res, 401, { error: { code: 'UNAUTHORIZED' } });
      return;
    }
    json(res, 200, { data: { loggedOut: true, revoked: true } });
    return;
  }

  if (!authenticated(req)) {
    json(res, 401, { error: { code: 'UNAUTHORIZED' } });
    return;
  }

  const body = await readBody(req);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key === 'host' || key === 'content-length' || key === 'authorization') continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  headers.set('authorization', `Bearer ${legacyToken}`);
  headers.set('x-npp-delivery-employee-id', employeeId);

  const upstream = await fetch(`http://127.0.0.1:4010${url.pathname}${url.search}`, {
    method: req.method,
    headers,
    ...(body.length ? { body } : {}),
  });
  const responseBody = Buffer.from(await upstream.arrayBuffer());
  const responseHeaders = Object.fromEntries(upstream.headers.entries());
  res.writeHead(upstream.status, responseHeaders);
  res.end(responseBody);
});

server.listen(4011, '127.0.0.1', () => {
  console.log('delivery auth proxy listening on 4011');
});
