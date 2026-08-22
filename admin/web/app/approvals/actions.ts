'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requestCore } from '../../lib/core-api';

const DECISION_PATTERN = /^(approved|needs-info|rejected)$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export async function decideProposal(formData: FormData) {
  const proposalId = String(formData.get('proposalId') ?? '').trim();
  const decision = String(formData.get('decision') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim();
  const idempotencyKey = String(formData.get('idempotencyKey') ?? '').trim();

  if (!/^[A-Za-z0-9._-]{1,240}$/.test(proposalId)
    || !DECISION_PATTERN.test(decision)
    || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
    || note.length > 2000
    || ((decision === 'needs-info' || decision === 'rejected') && !note)) {
    throw new Error('proposal_decision_invalid');
  }

  await requestCore(`/api/management-proposals/${encodeURIComponent(proposalId)}/decision`, {
    method: 'POST',
    body: { decision, note },
    idempotencyKey,
  });

  revalidatePath('/approvals');
  revalidatePath(`/approvals/${proposalId}`);
  redirect(`/approvals/${encodeURIComponent(proposalId)}`);
}
