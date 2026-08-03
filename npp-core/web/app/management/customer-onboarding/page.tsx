import { redirect } from 'next/navigation';

export default function CustomerOnboardingRedirectPage() {
  const baseUrl = process.env.ADMIN_WEB_URL?.trim() || 'https://admin.nguyenlieuhungphat.com';
  redirect(`${baseUrl.replace(/\/$/, '')}/customer-onboarding`);
}
