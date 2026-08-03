import { redirect } from 'next/navigation';

export default function ManagementRedirectPage() {
  redirect(process.env.ADMIN_WEB_URL?.trim() || 'https://admin.nguyenlieuhungphat.com');
}
