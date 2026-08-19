import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson, sendSuccess } from '../http-utils.js';
import { readJsonBody, normalizeIdempotencyKey } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as service from '../services/document-print-templates.js';

const OWNER_ROLES = new Set(['system:security-owner', 'system:implementation-owner']);

function error(code, message, retryable = false, statusCode = 400) {
  return { code, message, details: {}, retryable, statusCode };
}

function statusFor(result) {
  if (result.code === 'PRINT_TEMPLATE_NOT_FOUND') return 404;
  if (result.code === 'CONFLICT') return 409;
  return 400;
}

function sendServiceError(res, result, context) {
  sendError(res, error(result.code, result.message, Boolean(result.retryable), statusFor(result)), context.requestId, context.receivedAt);
}

function requireIdempotency(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    return key ? { ok: true, key } : { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Cần có mã nhận diện yêu cầu (Idempotency-Key)' };
  } catch (cause) {
    return { ok: false, code: cause.code ?? 'IDEMPOTENCY_KEY_INVALID', message: 'Mã nhận diện yêu cầu chỉ dùng 1–128 ký tự hợp lệ' };
  }
}

function canManagePrintTemplates(context) {
  const roles = Array.isArray(context.requestContext?.roles) ? context.requestContext.roles : [];
  if (roles.some((role) => OWNER_ROLES.has(role))) return { ok: true };
  return context.authorize(context.requestContext, context.PERMISSIONS.corePrintTemplateManage);
}

export async function handleDocumentPrintTemplateRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (!(pathname === '/api/document-print-templates' || pathname.startsWith('/api/document-print-templates/'))) return false;
  const method = String(req.method ?? 'GET').toUpperCase();
  const context = options;

  if (pathname === '/api/document-print-templates' && method === 'GET') {
    try {
      const result = await service.listDocumentPrintTemplates(context.getPool(), { installationId: context.requestContext.installationId });
      sendSuccess(res, result.templates, context.requestId, context.receivedAt);
    } catch {
      sendError(res, error('PRINT_TEMPLATE_STORAGE_UNAVAILABLE', 'Cấu hình mẫu in tạm thời chưa sẵn sàng', true, 503), context.requestId, context.receivedAt);
    }
    return true;
  }

  const match = pathname.match(/^\/api\/document-print-templates\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match || method !== 'PATCH') return false;

  const permission = canManagePrintTemplates(context);
  if (!permission.ok) {
    sendError(res, error(permission.code, permission.message, false, permission.statusCode ?? 403), context.requestId, context.receivedAt);
    return true;
  }

  const idempotency = requireIdempotency(req);
  if (!idempotency.ok) {
    sendError(res, error(idempotency.code, idempotency.message, false, 400), context.requestId, context.receivedAt);
    return true;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (cause) {
    sendError(res, error(cause.code, cause.publicMessage, false, cause.statusCode), context.requestId, context.receivedAt);
    return true;
  }
  try {
    const execution = await context.executeRequestWithIdempotency({
      idempotencyStore: context.idempotencyStore,
      req,
      requestContext: context.requestContext,
      requestId: context.requestId,
      receivedAt: context.receivedAt,
      route: pathname,
      payload: body,
      onProcess: async () => {
        const tx = await withAuditOutboxTransaction({
          adapter: context.getPool(),
          mutate: async (client) => {
            const result = await service.updateDocumentPrintTemplate(client, {
              installationId: context.requestContext.installationId,
              documentType: match[1],
              templateCode: match[2],
              payload: body,
              actorId: context.requestContext.actorId,
            });
            if (!result.ok) return { failed: result, skipAudit: true };
            await insertAuditRecord(client, buildAuditRecord({
              requestContext: context.requestContext,
              action: result.reset ? 'reset' : 'update',
              resourceType: 'document_print_template',
              resourceId: `${result.template.documentType}:${result.template.templateCode}`,
              beforeData: result.beforeData,
              afterData: result.template,
              metadata: { documentType: result.template.documentType, templateCode: result.template.templateCode },
            }));
            return { template: result.template };
          },
        });
        if (tx.failed) {
          return {
            statusCode: statusFor(tx.failed), contentType: 'application/json', requestId: context.requestId,
            body: { error: { code: tx.failed.code, message: tx.failed.message, retryable: Boolean(tx.failed.retryable), details: {} }, requestId: context.requestId, receivedAt: context.receivedAt },
          };
        }
        return {
          statusCode: 200,
          contentType: 'application/json',
          requestId: context.requestId,
          body: createSuccessEnvelope(tx.template, context.requestId, context.receivedAt),
        };
      },
    });
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? context.requestId, execution.response.contentType);
  } catch {
    sendError(res, error('PRINT_TEMPLATE_STORAGE_UNAVAILABLE', 'Cấu hình mẫu in tạm thời chưa sẵn sàng', true, 503), context.requestId, context.receivedAt);
  }
  return true;
}
