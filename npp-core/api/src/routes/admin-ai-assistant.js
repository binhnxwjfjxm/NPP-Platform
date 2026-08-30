import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import { queryGoogleAdminAgent } from '../services/google-admin-agent.js';
import { recordAdminAgentUsage } from '../services/admin-ai-usage.js';
import { ensureWarehouseScopes, normalizeFilters, validateScope } from './reporting-common.js';
import { salesReport } from './reporting-sales.js';

const ROOT = '/api/ai/admin-assistant';
const OWNER_ROLES = new Set(['bootstrap', 'system:security-owner', 'system:implementation-owner']);
const SAFE_CONVERSATION_ID = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_MESSAGE_LENGTH = 6000;
const SALES_QUESTION = /(kinh\s*doanh|doanh\s*(thu|số)|bán\s*hàng|sản\s*lượng|khách\s*hàng|loại\s*khách|kênh\s*bán|sku|nhóm\s*hàng|nhân\s*viên\s*bán)/iu;

function apiError(code, message, details = {}, retryable = false, statusCode = 500) { return Object.assign(new Error(code), { code, publicMessage: message, details, retryable, statusCode }); }
function ownerAllowed(context) { const roles = Array.isArray(context?.roles) ? context.roles : []; return roles.some((role) => OWNER_ROLES.has(role)); }
function requireIdempotencyKey(req) { const raw = req.headers['idempotency-key']; if (raw === undefined || raw === null) throw apiError('IDEMPOTENCY_KEY_REQUIRED', 'Yêu cầu Trợ lý Công Ty cần mã chống gửi trùng', {}, false, 400); try { return normalizeIdempotencyKey(raw); } catch { throw apiError('IDEMPOTENCY_KEY_INVALID', 'Mã chống gửi trùng không hợp lệ', {}, false, 400); } }
function normalizePayload(payload) { if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw apiError('ADMIN_AI_REQUEST_INVALID', 'Nội dung cần hỏi chưa hợp lệ', {}, false, 400); const message = String(payload.message ?? '').trim(); const conversationId = String(payload.conversationId ?? '').trim(); if (!message || message.length > MAX_MESSAGE_LENGTH) throw apiError('ADMIN_AI_MESSAGE_INVALID', 'Nội dung cần hỏi phải có từ 1 đến 6.000 ký tự', {}, false, 400); if (!SAFE_CONVERSATION_ID.test(conversationId)) throw apiError('ADMIN_AI_CONVERSATION_INVALID', 'Phiên Trợ lý Công Ty không hợp lệ', {}, false, 400); return Object.freeze({ message, conversationId }); }
async function authenticate(req, res, options) { const auth = options.authenticate(req, options.config); if (!auth.ok) { res.setHeader('WWW-Authenticate', 'Bearer'); sendError(res, apiError('UNAUTHORIZED', 'Cần đăng nhập', {}, false, 401), options.requestId, options.receivedAt); return null; } return options.createContext({ config: options.config, principal: auth.principal, requestId: options.requestId, receivedAt: options.receivedAt }); }
function publicFailure(res, error, options) { if (error?.publicMessage && Number.isInteger(error?.statusCode)) { sendError(res, apiError(error.code ?? 'ADMIN_AI_UNAVAILABLE', error.publicMessage, error.details ?? {}, Boolean(error.retryable), error.statusCode), options.requestId, options.receivedAt); return; } sendError(res, apiError('ADMIN_AI_UNAVAILABLE', 'Trợ lý Công Ty tạm thời chưa sẵn sàng', {}, true, 503), options.requestId, options.receivedAt); }
function permissionAllowed(options, context, key) { const permission = options.PERMISSIONS?.[key]; return Boolean(permission && options.authorize(context, permission).ok); }

async function canonicalSalesContext(options, context) {
  if (!permissionAllowed(options, context, 'coreReportingSalesRead')) return Object.freeze({ available: false, reason: 'Tài khoản hiện tại không có quyền xem Báo cáo Kinh doanh.' });
  try {
    const scoped = await ensureWarehouseScopes(options.getPool(), context);
    const filters = normalizeFilters({}, new Date(options.receivedAt));
    if (!filters.ok) return Object.freeze({ available: false, reason: 'Phạm vi thời gian Kinh doanh chưa hợp lệ.' });
    const scope = validateScope(scoped, filters);
    if (!scope.ok) return Object.freeze({ available: false, reason: 'Phạm vi kho Kinh doanh chưa sẵn sàng.' });
    const report = await salesReport(options.getPool(), scoped, filters, scope.warehouseIds);
    return Object.freeze({ available: true, report: Object.freeze({ contractVersion: report.contractVersion, filters: report.filters, summary: report.summary, comparison: report.comparison, breakdowns: Object.freeze(Object.fromEntries(Object.entries(report.breakdowns).map(([key, value]) => [key, Object.freeze(value.slice(0, 20))]))), dataQuality: report.dataQuality, reconciliation: report.reconciliation }) });
  } catch (error) {
    console.error(JSON.stringify({ event: 'admin_ai_sales_context_failed', requestId: options.requestId, errorCode: typeof error?.code === 'string' ? error.code : null }));
    return Object.freeze({ available: false, reason: 'Báo cáo Kinh doanh chưa đối soát được ở thời điểm hiện tại.' });
  }
}

function messageWithSalesContext(message, salesContext) {
  return `${message}\n\n---\nDỮ LIỆU KINH DOANH CANONICAL CỦA CÔNG TY\n${JSON.stringify(salesContext.report)}\n---\nQuy tắc trả lời: Chỉ dùng khối dữ liệu trên cho số liệu Kinh doanh. Không tự cộng chéo tiền tệ hoặc ĐVT. Nếu người dùng hỏi kỳ khác filters, nói rõ dữ liệu hiện có chưa đủ cho kỳ đó. Nếu dataQuality có cảnh báo legacy, phải nêu giới hạn đó; không biến tham chiếu danh mục hiện tại thành lịch sử đã được chụp.`;
}

export async function handleAdminAiAssistantRoutes(req, res, options) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1'); if (url.pathname !== ROOT) return false;
  const context = await authenticate(req, res, options); if (!context) return true;
  if (!ownerAllowed(context)) { sendError(res, apiError('FORBIDDEN', 'Tài khoản hiện tại không có quyền dùng Trợ lý Công Ty', {}, false, 403), options.requestId, options.receivedAt); return true; }
  if (String(req.method ?? 'GET').toUpperCase() !== 'POST') { sendError(res, apiError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ', {}, false, 405), options.requestId, options.receivedAt); return true; }
  let idempotencyKey, payload; try { idempotencyKey = requireIdempotencyKey(req); payload = normalizePayload(await readJsonBody(req)); } catch (error) { publicFailure(res, error, options); return true; }
  try {
    const execution = await options.executeRequestWithIdempotency({
      idempotencyStore: options.idempotencyStore, req, requestContext: context, requestId: options.requestId, receivedAt: options.receivedAt, route: ROOT, payload,
      onProcess: async () => {
        let providerMessage = payload.message;
        if (SALES_QUESTION.test(payload.message)) {
          const salesContext = await canonicalSalesContext(options, context);
          if (!salesContext.available) return { statusCode: 200, contentType: 'application/json', requestId: options.requestId, body: createSuccessEnvelope({ replyText: `${salesContext.reason} Em không tự suy đoán số liệu thay cho nguồn báo cáo.`, conversationId: payload.conversationId, usageRecorded: false, usage: null, readOnly: true }, options.requestId, options.receivedAt) };
          providerMessage = messageWithSalesContext(payload.message, salesContext);
        }
        const providerResult = await queryGoogleAdminAgent({ env: options.env ?? process.env, fetchImpl: options.fetchImpl ?? fetch, actorId: context.actorId, conversationId: payload.conversationId, message: providerMessage });
        let usageRecorded = false, usage = null;
        if (providerResult.usageMetadata) {
          try { usage = await recordAdminAgentUsage(options.getPool(), context, providerResult, idempotencyKey, options.requestId, options.receivedAt); usageRecorded = true; }
          catch (error) { console.error(JSON.stringify({ event: 'admin_ai_usage_record_failed', requestId: options.requestId, providerRequestId: providerResult.providerRequestId, errorCode: typeof error?.code === 'string' ? error.code : null })); }
        } else console.error(JSON.stringify({ event: 'admin_ai_usage_metadata_missing', requestId: options.requestId, providerRequestId: providerResult.providerRequestId }));
        return { statusCode: 200, contentType: 'application/json', requestId: options.requestId, body: createSuccessEnvelope({ replyText: providerResult.replyText, conversationId: providerResult.conversationId, usageRecorded, usage, readOnly: true }, options.requestId, options.receivedAt) };
      },
    });
    res.setHeader('Cache-Control', 'no-store'); sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
  } catch (error) { publicFailure(res, error, options); }
  return true;
}

export const adminAiAssistantInternals = Object.freeze({ SALES_QUESTION, messageWithSalesContext });
