export function createSuccessEnvelope(data, requestId, receivedAt) {
  return {
    data,
    requestId,
    receivedAt,
  };
}

export function createErrorEnvelope(error, requestId, receivedAt) {
  return {
    error: {
      code: error.code,
      message: error.message,
      details: error.details ?? {},
      retryable: Boolean(error.retryable),
    },
    requestId,
    receivedAt,
  };
}
