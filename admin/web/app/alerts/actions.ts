'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requestCore } from '../../lib/core-api';

const STATUS_PATTERN = /^(seen|handling|resolved)$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export async function changeAlertStatus(formData: FormData) {
  const alertId = String(formData.get('alertId') ?? '').trim();
  const status = String(formData.get('status') ?? '').trim();
  const period = String(formData.get('period') ?? 'Tháng này').trim();
  const from = String(formData.get('from') ?? '').trim();
  const to = String(formData.get('to') ?? '').trim();
  const idempotencyKey = String(formData.get('idempotencyKey') ?? '').trim();
  if (!alertId || alertId.includes('/') || !STATUS_PATTERN.test(status) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new Error('alert_action_invalid');
  }
  const query = new URLSearchParams({ from, to });
  await requestCore(`/api/reporting/admin-alerts/${encodeURIComponent(alertId)}?${query.toString()}`, {
    method: 'POST',
    body: { status },
    idempotencyKey,
  });
  revalidatePath('/alerts');
  revalidatePath(`/alerts/${alertId}`);
  redirect(`/alerts/${encodeURIComponent(alertId)}?period=${encodeURIComponent(period)}`);
}
