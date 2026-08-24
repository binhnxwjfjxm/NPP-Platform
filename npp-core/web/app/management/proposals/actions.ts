'use server';

import { redirect } from 'next/navigation';
import {
  createManagementProposal,
  ManagementProposalGatewayError,
  resubmitManagementProposal,
  resolveManagementProposalRequestId,
  type ManagementProposalDomain,
  type ManagementProposalPriority,
} from '../../../lib/management-proposal-gateway';

export type ProposalActionState = { error: string | null; idempotencyKey: string | null };

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

class ProposalFormError extends Error {
  constructor(public readonly publicMessage: string) { super(publicMessage); }
}

function requiredValue(formData: FormData, key: string, max: number) {
  const normalized = String(formData.get(key) ?? '').trim();
  if (!normalized) throw new ProposalFormError('Vui lòng nhập Tiêu đề và Nội dung đề xuất.');
  if (normalized.length > max) throw new ProposalFormError('Nội dung đang dài hơn giới hạn cho phép. Vui lòng rút gọn rồi gửi lại.');
  return normalized;
}

function optionalValue(formData: FormData, key: string, max: number) {
  const normalized = String(formData.get(key) ?? '').trim();
  if (normalized.length > max) throw new ProposalFormError('Thông tin bổ sung đang dài hơn giới hạn cho phép. Vui lòng rút gọn rồi gửi lại.');
  return normalized;
}

function evidence(formData: FormData) {
  const raw = String(formData.get('evidence') ?? '');
  const entries = raw.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  if (entries.length > 50 || entries.some((item) => item.length > 1000)) throw new ProposalFormError('Phần bằng chứng / ghi chú đang quá dài. Vui lòng rút gọn rồi gửi lại.');
  return entries;
}

function submittedIdempotencyKey(formData: FormData) {
  const normalized = String(formData.get('idempotencyKey') ?? '').trim();
  return IDEMPOTENCY_KEY_PATTERN.test(normalized) ? normalized : null;
}

function actionError(error: unknown, submittedKey: string | null): ProposalActionState {
  if (error instanceof ProposalFormError) {
    return { error: error.publicMessage, idempotencyKey: null };
  }
  if (error instanceof ManagementProposalGatewayError) {
    if (error.statusCode === 403) return { error: 'Tài khoản hiện tại chưa được cấp quyền gửi Đề xuất.', idempotencyKey: null };
    if (error.statusCode === 409) return { error: 'Đề xuất đã thay đổi trạng thái. Vui lòng tải lại rồi thực hiện lại.', idempotencyKey: null };
    if (error.statusCode === 400 || error.statusCode === 422) return { error: error.publicMessage || 'Thông tin Đề xuất chưa hợp lệ.', idempotencyKey: null };
    if (error.retryable || error.statusCode >= 500) {
      return {
        error: 'Chưa gửi được Đề xuất vì dịch vụ tạm thời chưa sẵn sàng. Nội dung vừa nhập vẫn được giữ; vui lòng thử lại.',
        idempotencyKey: submittedKey,
      };
    }
    return { error: error.publicMessage || 'Chưa gửi được Đề xuất ở thời điểm hiện tại.', idempotencyKey: null };
  }
  return {
    error: 'Chưa gửi được Đề xuất ở thời điểm hiện tại. Nội dung vừa nhập vẫn được giữ; vui lòng thử lại.',
    idempotencyKey: submittedKey,
  };
}

function validatedIdempotencyKey(formData: FormData) {
  const idempotencyKey = requiredValue(formData, 'idempotencyKey', 128);
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new ProposalFormError('Yêu cầu gửi không hợp lệ. Vui lòng tải lại trang rồi thử lại.');
  }
  return idempotencyKey;
}

export async function createProposalAction(_previousState: ProposalActionState, formData: FormData): Promise<ProposalActionState> {
  const submittedKey = submittedIdempotencyKey(formData);
  try {
    const idempotencyKey = validatedIdempotencyKey(formData);
    await createManagementProposal({
      domain: (optionalValue(formData, 'domain', 32) || 'commercial') as ManagementProposalDomain,
      title: requiredValue(formData, 'title', 240),
      content: requiredValue(formData, 'content', 4000),
      entityType: optionalValue(formData, 'entityType', 96) || 'other',
      entityId: optionalValue(formData, 'entityId', 240),
      entityLabel: optionalValue(formData, 'entityLabel', 240),
      impact: optionalValue(formData, 'impact', 1000),
      reason: optionalValue(formData, 'reason', 4000),
      rule: optionalValue(formData, 'rule', 1000),
      evidence: evidence(formData),
      priority: (optionalValue(formData, 'priority', 16) || 'normal') as ManagementProposalPriority,
    }, resolveManagementProposalRequestId(null), idempotencyKey);
  } catch (error) {
    return actionError(error, submittedKey);
  }
  redirect('/management/proposals?sent=1');
}

export async function resubmitProposalAction(_previousState: ProposalActionState, formData: FormData): Promise<ProposalActionState> {
  const submittedKey = submittedIdempotencyKey(formData);
  try {
    const idempotencyKey = validatedIdempotencyKey(formData);
    await resubmitManagementProposal({
      id: requiredValue(formData, 'proposalId', 240),
      content: requiredValue(formData, 'content', 4000),
      reason: optionalValue(formData, 'reason', 4000),
      evidence: evidence(formData),
    }, resolveManagementProposalRequestId(null), idempotencyKey);
  } catch (error) {
    return actionError(error, submittedKey);
  }
  redirect('/management/proposals?resubmitted=1');
}
