import { isValidIdempotencyKey } from '@npp/contracts';
import { NextRequest, NextResponse } from 'next/server';
import { CoreApiError, requestCore } from '../../../../lib/core-api';

type AssistantResponse = {
  replyText: string;
  conversationId: string;
  usageRecorded: boolean;
  usage: { eventId: string; model: string; totalTokens: number; usageUsd: string; rateCardVersion: string } | null;
  readOnly: true;
};

const ASSISTANT_REQUEST_TIMEOUT_MS = 95_000;

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? '';
  if (!isValidIdempotencyKey(idempotencyKey)) {
    return NextResponse.json({ message: 'Yêu cầu chưa có mã chống gửi trùng hợp lệ', retryable: false }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Nội dung cần hỏi chưa hợp lệ', retryable: false }, { status: 400 });
  }

  try {
    const data = await requestCore<AssistantResponse>('/api/ai/admin-assistant', {
      method: 'POST',
      body,
      idempotencyKey,
      timeoutMs: ASSISTANT_REQUEST_TIMEOUT_MS,
    });
    return NextResponse.json(data, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof CoreApiError) {
      return NextResponse.json(
        { message: error.publicMessage, retryable: error.retryable },
        { status: error.statusCode, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(
      { message: 'Trợ lý Công Ty tạm thời chưa sẵn sàng', retryable: true },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
