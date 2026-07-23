import { NextResponse } from "next/server";

export type ApiOk<T> = {
  ok: true;
  data: T;
};

export type ApiFail = {
  ok: false;
  error: {
    message: string;
  };
};

export function ok<T>(data: T) {
  return NextResponse.json<ApiOk<T>>({ ok: true, data });
}

export function fail(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : "Unknown server error";
  return NextResponse.json<ApiFail>({ ok: false, error: { message } }, { status });
}
