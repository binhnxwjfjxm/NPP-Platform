import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { RETAIL_SESSION_COOKIE } from '../../../../lib/company-gateway';

export async function GET() {
  const token = cookies().get(RETAIL_SESSION_COOKIE)?.value?.trim();
  if (!token?.startsWith('nppusr.')) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Cần đăng nhập để tiếp tục' } },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const scope = createHash('sha256').update(token).digest('hex').slice(0, 32);
  return NextResponse.json(
    { data: { scope } },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
