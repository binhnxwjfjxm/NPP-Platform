import { redirect } from 'next/navigation';

export default function LegacyEmployeesPage() {
  redirect('/workforce/employees');
}
