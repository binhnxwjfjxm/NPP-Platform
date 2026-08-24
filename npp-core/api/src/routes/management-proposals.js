import { randomUUID } from 'node:crypto';
import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson, sendSuccess } from '../http-utils.js';
import { readJsonBody } from '../idempotency.js';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';

const ROOT = '/api/management-proposals';
const SAFE_ID = /^[A-Za-z0-9._-]{1,240}$/;
const SOURCES = new Set(['company', 'mcp']);
const DOMAINS = new Set(['commercial', 'customer-debt', 'operations', 'mcp']);
const PRIORITIES = new Set(['critical', 'high', 'normal']);
const DECISIONS = new Set(['approved', 'needs-info', 'rejected']);
const ENTITY_TYPES = new Set(['customer', 'sales-order', 'purchase-order', 'document', 'route', 'employee', 'outlet', 'other']);
const COMPANY_SUBMIT_PERMISSION = 'core.management-proposal.submit';
const MCP_SUBMIT_PERMISSION = 'mcp.report.write';
const MCP_SERVICE_ROLE = 'mcp-sales-order-service';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function text(value, max = 1000) {
  const normalized = String(value ?? '').trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function optionalText(value, max = 1000) {
  const normalized = String(value ?? '').trim();
  return normalized.length <= max ? normalized : null;
}

function evidence(value) {
  if (!Array.isArray(value) || value.length > 50) return null;
  const normalized = value.map((item) => text(item, 1000));
  return normalized.every(Boolean) ? normalized : null;
}

function roles(context) {
  return Array.isArray(context.roles) ? context.roles : [];
}

function permissions(context) {
  return Array.isArray(context.permissions) ? context.permissions : [];
}

function canManage(context) {
  const currentRoles = roles(context);
  return currentRoles.includes('bootstrap')
    || currentRoles.includes('system:security-owner')
    || currentRoles.includes('system:implementation-owner');
}

function canSubmit(context, source) {
  if (canManage(context)) return true;
  if (source === 'company') return permissions(context).includes(COMPANY_SUBMIT_PERMISSION);
  if (source === 'mcp') {
    return permissions(context).includes(MCP_SUBMIT_PERMISSION)
      || (roles(context).includes(MCP_SERVICE_ROLE) && Boolean(context.employeeId));
  }
  return false;
}

function canReadSource(context) {
  return canManage(context) || canSubmit(context, 'company') || canSubmit(context, 'mcp');
}

function actorLabel(context, fallback) {
  return text(fallback, 240) || String(context.employeeId ?? context.actorId ?? 'Người dùng');
}

function ownsProposal(context, row) {
  if (canManage(context)) return true;
  if (!canSubmit(context, String(row.source))) return false;
  if (context.employeeId) {
    return row.requester_employee_id != null
      && String(row.requester_employee_id) === String(context.employeeId);
  }
  return String(row.requester_actor_id) === String(context.actorId);
}

function parsePath(pathname) {
  if (pathname === ROOT) return { kind: 'root' };
  if (!pathname.startsWith(`${ROOT}/`)) return null;
  const parts = pathname.slice(ROOT.length + 1).split('/').filter(Boolean);
  if (!parts.length || parts.length > 2) return { kind: 'invalid' };
  let id;
  try { id = decodeURIComponent(parts[0]); } catch { return { kind: 'invalid' }; }
  if (!SAFE_ID.test(id)) return { kind: 'invalid' };
  return parts.length === 1 ? { kind: 'detail', id } : { kind: parts[1], id };
}

function normalizeCreate(payload) {
  const source = String(payload?.source ?? '').trim().toLowerCase();
  const defaultDomain = source === 'mcp' ? 'mcp' : 'commercial';
  const domain = String(payload?.domain ?? '').trim().toLowerCase() || defaultDomain;
  const priority = String(payload?.priority ?? '').trim().toLowerCase() || 'normal';
  const entityType = String(payload?.entityType ?? '').trim().toLowerCase() || 'other';
  const normalizedEvidence = evidence(payload?.evidence ?? []);
  const result = {
    source,
    domain,
    priority,
    title: text(payload?.title, 240),
    content: text(payload?.content, 4000),
    entityType,
    entityId: optionalText(payload?.entityId, 240),
    entityLabel: optionalText(payload?.entityLabel, 240),
    impact: optionalText(payload?.impact, 1000),
    reason: optionalText(payload?.reason, 4000),
    rule: optionalText(payload?.rule, 1000),
    evidence: normalizedEvidence,
    requesterName: text(payload?.requesterName, 240),
  };
  if (!SOURCES.has(source) || !DOMAINS.has(domain) || !PRIORITIES.has(priority) || !ENTITY_TYPES.has(entityType)) return null;
  if ((source === 'mcp') !== (domain === 'mcp')) return null;
  if (!result.title || !result.content || result.entityId === null || result.entityLabel === null
    || result.impact === null || result.reason === null || result.rule === null || normalizedEvidence === null) return null;
  return result;
}

function publicProposal(row, history = []) {
  return Object.freeze({
    id: String(row.id),
    source: String(row.source),
    domain: String(row.domain),
    title: String(row.title),
    content: String(row.content),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id ?? ''),
    entityLabel: String(row.entity_label ?? ''),
    impact: String(row.impact ?? ''),
    reason: String(row.reason ?? ''),
    rule: String(row.rule_text ?? ''),
    evidence: Object.freeze(Array.isArray(row.evidence) ? row.evidence.map(String) : []),
    priority: String(row.priority),
    status: String(row.status),
    requesterName: String(row.requester_name),
    requesterEmployeeId: row.requester_employee_id == null ? null : String(row.requester_employee_id),
    decisionNote: row.decision_note == null ? null : String(row.decision_note),
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at ?? null,
    history: Object.freeze(history),
  });
}

function publicEvent(row) {
  return Object.freeze({
    id: String(row.id),
    eventType: String(row.event_type),
    fromStatus: row.from_status == null ? null : String(row.from_status),
    toStatus: String(row.to_status),
    actorLabel: String(row.actor_label),
    note: row.note == null ? null : String(row.note),
    occurredAt: row.occurred_at,
  });
}

async function authenticate(req, res, options) {
  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Cần đăng nhập', {}, false, 401), options.requestId, options.receivedAt);
    return null;
  }
  return options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
}

async function listProposals(adapter, context, url) {
  const status = String(url.searchParams.get('status') ?? '').trim().toLowerCase();
  const domain = String(url.searchParams.get('domain') ?? '').trim().toLowerCase();
  const source = String(url.searchParams.get('source') ?? '').trim().toLowerCase();
  if (status && !new Set(['pending', 'needs-info', 'approved', 'rejected']).has(status)) {
    throw Object.assign(new Error('INVALID_PROPOSAL_FILTER'), { code: 'INVALID_PROPOSAL_FILTER', publicMessage: 'Bộ lọc trạng thái không hợp lệ', statusCode: 400 });
  }
  if (domain && !DOMAINS.has(domain)) throw Object.assign(new Error('INVALID_PROPOSAL_FILTER'), { code: 'INVALID_PROPOSAL_FILTER', publicMessage: 'Bộ lọc nhóm đề xuất không hợp lệ', statusCode: 400 });
  if (source && !SOURCES.has(source)) throw Object.assign(new Error('INVALID_PROPOSAL_FILTER'), { code: 'INVALID_PROPOSAL_FILTER', publicMessage: 'Bộ lọc nguồn đề xuất không hợp lệ', statusCode: 400 });

  const manager = canManage(context);
  const allowedSources = manager
    ? ['company', 'mcp']
    : ['company', 'mcp'].filter((candidate) => canSubmit(context, candidate));
  const employeeId = context.employeeId ? String(context.employeeId) : '';
  const actorId = String(context.actorId ?? '');
  const result = await adapter.query(
    `SELECT * FROM shared.management_proposals
      WHERE installation_id = $1
        AND ($2::text = '' OR status = $2)
        AND ($3::text = '' OR domain = $3)
        AND ($4::text = '' OR source = $4)
        AND source = ANY($5::text[])
        AND (
          $6::boolean = true
          OR (CASE WHEN $7::text <> '' THEN requester_employee_id::text = $7 ELSE requester_actor_id = $8 END)
        )
      ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'needs-info' THEN 1 ELSE 2 END,
               updated_at DESC, id DESC
      LIMIT 500`,
    [context.installationId, status, domain, source, allowedSources, manager, employeeId, actorId],
  );
  return Object.freeze({ proposals: Object.freeze((result.rows ?? []).map((row) => publicProposal(row))) });
}

async function loadDetail(adapter, context, id) {
  const result = await adapter.query(
    'SELECT * FROM shared.management_proposals WHERE installation_id = $1 AND id = $2',
    [context.installationId, id],
  );
  const row = result.rows?.[0];
  if (!row || !ownsProposal(context, row)) return null;
  const events = await adapter.query(
    `SELECT * FROM shared.management_proposal_events
      WHERE installation_id = $1 AND proposal_id = $2
      ORDER BY occurred_at ASC, id ASC`,
    [context.installationId, id],
  );
  return publicProposal(row, (events.rows ?? []).map(publicEvent));
}

function response(data, requestId, receivedAt, statusCode = 200) {
  return Object.freeze({ statusCode, contentType: 'application/json', requestId, body: createSuccessEnvelope(data, requestId, receivedAt) });
}

async function resolveRequesterName(client, context, requestedName) {
  const managerSupplied = canManage(context) ? text(requestedName, 240) : null;
  if (managerSupplied) return managerSupplied;
  if (context.employeeId) {
    const employee = await client.query(
      `SELECT full_name FROM shared.employees
        WHERE installation_id = $1 AND id = $2::uuid AND is_active = true
        LIMIT 1`,
      [context.installationId, context.employeeId],
    );
    const employeeName = text(employee.rows?.[0]?.full_name, 240);
    if (employeeName) return employeeName;
  }
  return actorLabel(context, null);
}

async function createProposal(options, context, normalized) {
  const id = `proposal_${randomUUID()}`;
  return withAuditOutboxTransaction({
    adapter: options.getPool(),
    mutate: async (client) => {
      const requesterName = await resolveRequesterName(client, context, normalized.requesterName);
      const created = await client.query(
        `INSERT INTO shared.management_proposals (
          id, installation_id, source, domain, title, content, entity_type, entity_id, entity_label,
          impact, reason, rule_text, evidence, priority, status,
          requester_actor_id, requester_employee_id, requester_name
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,'pending',$15,$16,$17)
        RETURNING *`,
        [id, context.installationId, normalized.source, normalized.domain, normalized.title,
          normalized.content, normalized.entityType, normalized.entityId, normalized.entityLabel, normalized.impact,
          normalized.reason, normalized.rule, JSON.stringify(normalized.evidence), normalized.priority,
          context.actorId, context.employeeId ?? null, requesterName],
      );
      await client.query(
        `INSERT INTO shared.management_proposal_events (
          id, installation_id, proposal_id, event_type, from_status, to_status,
          actor_id, employee_id, actor_label, note
        ) VALUES ($1,$2,$3,'submitted',NULL,'pending',$4,$5,$6,$7)`,
        [`proposal_event_${randomUUID()}`, context.installationId, id, context.actorId,
          context.employeeId ?? null, requesterName, normalized.content],
      );
      const proposal = publicProposal(created.rows[0]);
      await insertAuditRecord(client, buildAuditRecord({
        requestContext: context,
        action: 'management.proposal.submitted',
        resourceType: 'management-proposal',
        resourceId: id,
        afterData: proposal,
        metadata: { source: normalized.source, domain: normalized.domain, entityId: normalized.entityId },
      }));
      await insertOutboxEvent(client, buildOutboxEvent({
        requestContext: context,
        aggregateType: 'management-proposal',
        aggregateId: id,
        eventType: 'management.proposal.submitted',
        payload: { proposalId: id, source: normalized.source, domain: normalized.domain, entityType: normalized.entityType, entityId: normalized.entityId },
      }));
      return proposal;
    },
  });
}

async function decideProposal(options, context, id, decision, note) {
  return withAuditOutboxTransaction({
    adapter: options.getPool(),
    mutate: async (client) => {
      const currentResult = await client.query(
        'SELECT * FROM shared.management_proposals WHERE installation_id = $1 AND id = $2 FOR UPDATE',
        [context.installationId, id],
      );
      const current = currentResult.rows?.[0];
      if (!current) throw Object.assign(new Error('PROPOSAL_NOT_FOUND'), { code: 'PROPOSAL_NOT_FOUND', publicMessage: 'Đề xuất không còn tồn tại', statusCode: 404 });
      if (current.status !== 'pending') throw Object.assign(new Error('PROPOSAL_STATUS_CONFLICT'), { code: 'PROPOSAL_STATUS_CONFLICT', publicMessage: 'Đề xuất đã thay đổi trạng thái. Vui lòng tải lại.', statusCode: 409 });
      if ((decision === 'needs-info' || decision === 'rejected') && !note) {
        throw Object.assign(new Error('PROPOSAL_DECISION_NOTE_REQUIRED'), { code: 'PROPOSAL_DECISION_NOTE_REQUIRED', publicMessage: 'Vui lòng ghi rõ lý do', statusCode: 400 });
      }
      const updatedResult = await client.query(
        `UPDATE shared.management_proposals
            SET status = $3, decision_note = $4, decided_by_actor_id = $5,
                decided_at = now(), version = version + 1, updated_at = now()
          WHERE installation_id = $1 AND id = $2
          RETURNING *`,
        [context.installationId, id, decision, note || null, context.actorId],
      );
      await client.query(
        `INSERT INTO shared.management_proposal_events (
          id, installation_id, proposal_id, event_type, from_status, to_status,
          actor_id, employee_id, actor_label, note
        ) VALUES ($1,$2,$3,'decision','pending',$4,$5,$6,$7,$8)`,
        [`proposal_event_${randomUUID()}`, context.installationId, id, decision, context.actorId,
          context.employeeId ?? null, actorLabel(context, null), note || null],
      );
      const before = publicProposal(current);
      const after = publicProposal(updatedResult.rows[0]);
      await insertAuditRecord(client, buildAuditRecord({
        requestContext: context,
        action: 'management.proposal.decision',
        resourceType: 'management-proposal',
        resourceId: id,
        beforeData: before,
        afterData: after,
        metadata: { decision, source: current.source, domain: current.domain, entityId: current.entity_id },
      }));
      await insertOutboxEvent(client, buildOutboxEvent({
        requestContext: context,
        aggregateType: 'management-proposal',
        aggregateId: id,
        eventType: 'management.proposal.decision-recorded',
        payload: { proposalId: id, decision, source: current.source, domain: current.domain, entityType: current.entity_type, entityId: current.entity_id },
      }));
      return after;
    },
  });
}

async function resubmitProposal(options, context, id, payload) {
  const nextContent = text(payload?.content, 4000);
  const nextReason = optionalText(payload?.reason, 4000);
  const nextEvidence = evidence(payload?.evidence ?? []);
  if (!nextContent || nextReason === null || nextEvidence === null) throw Object.assign(new Error('PROPOSAL_RESUBMIT_INVALID'), { code: 'PROPOSAL_RESUBMIT_INVALID', publicMessage: 'Nội dung bổ sung không hợp lệ', statusCode: 400 });
  return withAuditOutboxTransaction({
    adapter: options.getPool(),
    mutate: async (client) => {
      const currentResult = await client.query(
        'SELECT * FROM shared.management_proposals WHERE installation_id = $1 AND id = $2 FOR UPDATE',
        [context.installationId, id],
      );
      const current = currentResult.rows?.[0];
      if (!current) throw Object.assign(new Error('PROPOSAL_NOT_FOUND'), { code: 'PROPOSAL_NOT_FOUND', publicMessage: 'Đề xuất không còn tồn tại', statusCode: 404 });
      if (current.status !== 'needs-info') throw Object.assign(new Error('PROPOSAL_STATUS_CONFLICT'), { code: 'PROPOSAL_STATUS_CONFLICT', publicMessage: 'Đề xuất không ở trạng thái chờ bổ sung', statusCode: 409 });
      if (!ownsProposal(context, current)) {
        throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN', publicMessage: 'Tài khoản hiện tại không được bổ sung đề xuất này', statusCode: 403 });
      }
      const updatedResult = await client.query(
        `UPDATE shared.management_proposals
            SET status = 'pending', content = $3, reason = $4, evidence = $5::jsonb,
                decision_note = NULL, decided_by_actor_id = NULL, decided_at = NULL,
                version = version + 1, updated_at = now()
          WHERE installation_id = $1 AND id = $2
          RETURNING *`,
        [context.installationId, id, nextContent, nextReason, JSON.stringify(nextEvidence)],
      );
      await client.query(
        `INSERT INTO shared.management_proposal_events (
          id, installation_id, proposal_id, event_type, from_status, to_status,
          actor_id, employee_id, actor_label, note
        ) VALUES ($1,$2,$3,'resubmitted','needs-info','pending',$4,$5,$6,$7)`,
        [`proposal_event_${randomUUID()}`, context.installationId, id, context.actorId,
          context.employeeId ?? null, actorLabel(context, current.requester_name), nextContent],
      );
      const after = publicProposal(updatedResult.rows[0]);
      await insertAuditRecord(client, buildAuditRecord({
        requestContext: context,
        action: 'management.proposal.resubmitted',
        resourceType: 'management-proposal',
        resourceId: id,
        beforeData: publicProposal(current),
        afterData: after,
        metadata: { source: current.source, domain: current.domain, entityId: current.entity_id },
      }));
      await insertOutboxEvent(client, buildOutboxEvent({
        requestContext: context,
        aggregateType: 'management-proposal',
        aggregateId: id,
        eventType: 'management.proposal.resubmitted',
        payload: { proposalId: id, source: current.source, domain: current.domain, entityType: current.entity_type, entityId: current.entity_id },
      }));
      return after;
    },
  });
}

async function runIdempotent(req, res, options, context, route, payload, statusCode, process) {
  try {
    const execution = await options.executeRequestWithIdempotency({
      idempotencyStore: options.idempotencyStore,
      req,
      requestContext: context,
      requestId: options.requestId,
      receivedAt: options.receivedAt,
      route,
      payload,
      onProcess: async () => response(await process(), options.requestId, options.receivedAt, statusCode),
    });
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
  } catch (error) {
    if (error?.publicMessage && error?.statusCode) {
      sendError(res, apiError(error.code ?? 'MANAGEMENT_PROPOSAL_FAILED', error.publicMessage, {}, Boolean(error.retryable), error.statusCode), options.requestId, options.receivedAt);
      return;
    }
    sendError(res, apiError('MANAGEMENT_PROPOSAL_FAILED', 'Không thể xử lý đề xuất', {}, true, 503), options.requestId, options.receivedAt);
  }
}

export async function handleManagementProposalRoutes(req, res, options) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const target = parsePath(url.pathname);
  if (!target) return false;
  if (target.kind === 'invalid') {
    sendError(res, apiError('INVALID_PROPOSAL_ID', 'Mã đề xuất không hợp lệ', {}, false, 400), options.requestId, options.receivedAt);
    return true;
  }
  const context = await authenticate(req, res, options);
  if (!context) return true;
  const method = String(req.method ?? 'GET').toUpperCase();

  if (method === 'GET') {
    if (!canReadSource(context)) {
      sendError(res, apiError('FORBIDDEN', 'Tài khoản hiện tại không có quyền xem đề xuất', {}, false, 403), options.requestId, options.receivedAt);
      return true;
    }
    try {
      const data = target.kind === 'root'
        ? await listProposals(options.getPool(), context, url)
        : target.kind === 'detail'
          ? await loadDetail(options.getPool(), context, target.id)
          : null;
      if (target.kind !== 'root' && target.kind !== 'detail') {
        sendError(res, apiError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ', {}, false, 405), options.requestId, options.receivedAt);
      } else if (!data) {
        sendError(res, apiError('PROPOSAL_NOT_FOUND', 'Đề xuất không còn tồn tại', {}, false, 404), options.requestId, options.receivedAt);
      } else {
        res.setHeader('Cache-Control', 'no-store');
        sendSuccess(res, data, options.requestId, options.receivedAt);
      }
    } catch (error) {
      sendError(res, apiError(error.code ?? 'MANAGEMENT_PROPOSAL_READ_FAILED', error.publicMessage ?? 'Không tải được đề xuất', {}, false, error.statusCode ?? 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  if (method !== 'POST') {
    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  }

  let payload;
  try { payload = await readJsonBody(req); } catch (error) {
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
    return true;
  }

  if (target.kind === 'root') {
    const normalized = normalizeCreate(payload);
    if (!normalized) {
      sendError(res, apiError('PROPOSAL_PAYLOAD_INVALID', 'Nội dung đề xuất không hợp lệ', {}, false, 400), options.requestId, options.receivedAt);
      return true;
    }
    if (!canSubmit(context, normalized.source)) {
      sendError(res, apiError('FORBIDDEN', 'Tài khoản hiện tại không được gửi đề xuất từ nguồn này', {}, false, 403), options.requestId, options.receivedAt);
      return true;
    }
    await runIdempotent(req, res, options, context, ROOT, payload, 201, () => createProposal(options, context, normalized));
    return true;
  }

  if (target.kind === 'decision') {
    if (!canManage(context)) {
      sendError(res, apiError('FORBIDDEN', 'Tài khoản hiện tại không có quyền quyết định đề xuất', {}, false, 403), options.requestId, options.receivedAt);
      return true;
    }
    const decision = String(payload?.decision ?? '').trim().toLowerCase();
    const note = text(payload?.note, 2000) ?? '';
    if (!DECISIONS.has(decision)) {
      sendError(res, apiError('PROPOSAL_DECISION_INVALID', 'Quyết định không hợp lệ', {}, false, 400), options.requestId, options.receivedAt);
      return true;
    }
    await runIdempotent(req, res, options, context, `${ROOT}/${target.id}/decision`, payload, 200, () => decideProposal(options, context, target.id, decision, note));
    return true;
  }

  if (target.kind === 'resubmit') {
    await runIdempotent(req, res, options, context, `${ROOT}/${target.id}/resubmit`, payload, 200, () => resubmitProposal(options, context, target.id, payload));
    return true;
  }

  sendError(res, apiError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
