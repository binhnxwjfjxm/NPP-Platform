import { authorizeCommand } from './authorization.js';
import {
  createCoreManagementProposal,
  listCoreManagementProposals,
  readCoreManagementProposal,
  resubmitCoreManagementProposal,
} from './core-management-proposals.js';

const MAX_JSON_BODY_BYTES = 256 * 1024;
const REPORT_PERMISSION = 'mcp.report.write';
const SAFE_ID = /^[A-Za-z0-9._-]{1,240}$/;

function response(data, statusCode = 200) {
  return { statusCode, payload: { data, receivedAt: new Date().toISOString() } };
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) {
      const error = new Error('request_body_too_large');
      error.code = 'request_body_too_large';
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    const error = new Error('invalid_json_body');
    error.code = 'invalid_json_body';
    error.statusCode = 400;
    throw error;
  }
}

function matchPath(pathname) {
  if (pathname === '/api/management-proposals') return { kind: 'root' };
  const match = pathname.match(/^\/api\/management-proposals\/([^/]+)(?:\/(resubmit))?$/);
  if (!match) return null;
  let id;
  try { id = decodeURIComponent(match[1]); } catch { return { kind: 'invalid' }; }
  if (!SAFE_ID.test(id)) return { kind: 'invalid' };
  return { kind: match[2] || 'detail', id };
}

export async function handleManagementProposalApi(req, url, context, config, { fetchImpl = fetch } = {}) {
  const target = matchPath(url.pathname);
  if (!target) return null;
  if (target.kind === 'invalid') {
    const error = new Error('management_proposal_id_invalid');
    error.code = 'management_proposal_id_invalid';
    error.statusCode = 400;
    throw error;
  }

  authorizeCommand(context, { permission: REPORT_PERMISSION });
  const method = String(req.method || 'GET').toUpperCase();

  if (method === 'GET' && target.kind === 'root') {
    return response(await listCoreManagementProposals(context, config, { fetchImpl }));
  }
  if (method === 'GET' && target.kind === 'detail') {
    return response(await readCoreManagementProposal(target.id, context, config, { fetchImpl }));
  }
  if (method === 'POST' && target.kind === 'root') {
    const body = await readJsonBody(req);
    return response(await createCoreManagementProposal(body, context, config, {
      fetchImpl,
      idempotencyKey: context.idempotencyKey,
    }), 201);
  }
  if (method === 'POST' && target.kind === 'resubmit') {
    const body = await readJsonBody(req);
    return response(await resubmitCoreManagementProposal(target.id, body, context, config, {
      fetchImpl,
      idempotencyKey: context.idempotencyKey,
    }));
  }

  const error = new Error('method_not_allowed');
  error.code = 'method_not_allowed';
  error.statusCode = 405;
  throw error;
}
