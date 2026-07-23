Deno.serve((request: Request) => {
  const requestId = request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  return new Response(JSON.stringify({
    error: {
      code: "EDGE_FUNCTION_RETIRED",
      message: "This legacy endpoint is retired. Use the canonical backend API.",
      details: {},
      retryable: false
    },
    receivedAt: new Date().toISOString(),
    requestId
  }), {
    status: 410,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId
    }
  });
});
