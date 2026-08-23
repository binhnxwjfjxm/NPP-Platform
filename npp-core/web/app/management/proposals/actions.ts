'use server';

import { redirect } from 'next/navigation';
import {
  createManagementProposal,
  resubmitManagementProposal,
  resolveManagementProposalRequestId,
  type ManagementProposalDomain,
  type ManagementProposalPriority,
} from '../../../lib/management-proposal-gateway';

function value(formData: FormData, key: string, max: number) {
  const normalized = String(formData.get(key) ?? '').trim();
  if (!normalized || normalized.length > max) throw new Error('management_proposal_form_invalid');
  return normalized;
}

function evidence(formData: FormData) {
  const raw = String(formData.get('evidence') ?? '');
  const entries = raw.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  if (entries.length > 50 || entries.some((item) => item.length > 1000)) throw new Error('management_proposal_form_invalid');
  return entries;
}

export async function createProposalAction(formData: FormData) {
  const idempotencyKey = value(formData, 'idempotencyKey', 128);
  await createManagementProposal({
    domain: value(formData, 'domain', 32) as ManagementProposalDomain,
    title: value(formData, 'title', 240),
    content: value(formData, 'content', 4000),
    entityType: value(formData, 'entityType', 96),
    entityId: value(formData, 'entityId', 240),
    entityLabel: value(formData, 'entityLabel', 240),
    impact: value(formData, 'impact', 1000),
    reason: value(formData, 'reason', 4000),
    rule: value(formData, 'rule', 1000),
    evidence: evidence(formData),
    priority: value(formData, 'priority', 16) as ManagementProposalPriority,
  }, resolveManagementProposalRequestId(null), idempotencyKey);
  redirect('/management/proposals?sent=1');
}

export async function resubmitProposalAction(formData: FormData) {
  const idempotencyKey = value(formData, 'idempotencyKey', 128);
  await resubmitManagementProposal({
    id: value(formData, 'proposalId', 240),
    content: value(formData, 'content', 4000),
    reason: value(formData, 'reason', 4000),
    evidence: evidence(formData),
  }, resolveManagementProposalRequestId(null), idempotencyKey);
  redirect('/management/proposals?resubmitted=1');
}
