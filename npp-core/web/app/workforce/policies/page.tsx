import { listWorkPolicies, resolveWorkforceRequestId } from '../../../lib/workforce-gateway';
import type { WorkPolicy } from '../../../lib/workforce-types';
import WorkPolicyWorkspace from './work-policy-workspace';

export const dynamic = 'force-dynamic';

export default async function WorkPoliciesPage() {
  let policies: WorkPolicy[] = [];
  let initialError: string | null = null;
  try {
    policies = await listWorkPolicies<WorkPolicy[]>(resolveWorkforceRequestId(undefined));
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được chính sách làm việc';
  }
  return <WorkPolicyWorkspace initialPolicies={policies} initialError={initialError} />;
}
