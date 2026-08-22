import { sendError, sendJson } from '../http-utils.js';
import { readJsonBody } from '../idempotency.js';
import { alertMutationResponse, updateAdminAlertStatus } from './reporting-mcp-alerts.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function canManageAlerts(requestContext) {
  const roles = Array.isArray(requestContext.roles) ? requestContext.roles : [];
  return roles.includes('system:security-owner')
    || roles.includes('system:implementation-owner')
    || roles.includes('bootstrap');
}

export async function handleAdminAlertMutation({
  req,
  res,
  options,
  requestContext,
  filters,
  fieldScope,
  alertId,
}) {
  if (!canManageAlerts(requestContext)) {
    sendError(
      res,
      apiError('FORBIDDEN', 'Tài khoản hiện tại không có quyền thay đổi trạng thái cảnh báo', {}, false, 403),
      options.requestId,
      options.receivedAt,
    );
    return;
  }

  if (!alertId) {
    sendError(
      res,
      apiError('INVALID_ALERT_ID', 'Mã cảnh báo không hợp lệ', {}, false, 400),
      options.requestId,
      options.receivedAt,
    );
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendError(
      res,
      apiError(error.code, error.publicMessage, {}, false, error.statusCode),
      options.requestId,
      options.receivedAt,
    );
    return;
  }

  try {
    const execution = await options.executeRequestWithIdempotency({
      idempotencyStore: options.idempotencyStore,
      req,
      requestContext,
      requestId: options.requestId,
      receivedAt: options.receivedAt,
      route: `/api/reporting/admin-alerts/${alertId}`,
      payload,
      onProcess: async () => alertMutationResponse(
        await updateAdminAlertStatus({
          adapter: options.getPool(),
          requestContext,
          alertId,
          nextStatus: String(payload?.status ?? ''),
          filters,
          fieldScope,
        }),
        options.requestId,
        options.receivedAt,
      ),
    });

    res.setHeader('Cache-Control', 'no-store');
    sendJson(
      res,
      execution.response.statusCode,
      execution.response.body,
      execution.response.requestId ?? options.requestId,
      execution.response.contentType,
    );
  } catch (error) {
    if (error?.publicMessage && error?.statusCode) {
      sendError(
        res,
        apiError(
          error.code ?? 'ALERT_UPDATE_FAILED',
          error.publicMessage,
          {},
          Boolean(error.retryable),
          error.statusCode,
        ),
        options.requestId,
        options.receivedAt,
      );
      return;
    }

    sendError(
      res,
      apiError('ALERT_UPDATE_FAILED', 'Không thể cập nhật trạng thái cảnh báo', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
  }
}
