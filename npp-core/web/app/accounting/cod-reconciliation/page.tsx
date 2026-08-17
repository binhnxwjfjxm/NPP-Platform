import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function CodReconciliationPage() {
  redirect('/accounting/cod-reporting?tab=accounting');
}
