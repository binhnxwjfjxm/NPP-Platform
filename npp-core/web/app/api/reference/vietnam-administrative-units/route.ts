import { NextRequest, NextResponse } from 'next/server';
import { listVietnamProvinces, listVietnamWards } from '../../../../lib/vietnam-administrative-data';

export const dynamic = 'force-dynamic';

const headers = {
  'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
};

export async function GET(request: NextRequest) {
  const provinceCode = request.nextUrl.searchParams.get('provinceCode')?.trim() ?? '';

  if (!provinceCode) {
    return NextResponse.json(
      { data: { provinces: listVietnamProvinces(), wards: [] } },
      { status: 200, headers },
    );
  }

  return NextResponse.json(
    { data: { provinces: [], wards: listVietnamWards(provinceCode) } },
    { status: 200, headers },
  );
}
