import type { ApiErrorCode, ApiErrorEnvelope, ApiSuccessEnvelope } from "@provide/contracts";

const maxJsonBodyBytes = 64 * 1024;

function responseHeaders(requestId: string, initialHeaders?: HeadersInit): Headers {
  const headers = new Headers(initialHeaders);
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("x-request-id", requestId);
  return headers;
}

export function jsonSuccess<T>(
  data: T,
  requestId: string,
  status = 200,
  headers?: HeadersInit,
): Response {
  const body: ApiSuccessEnvelope<T> = { data, requestId };
  return Response.json(body, { headers: responseHeaders(requestId, headers), status });
}

export function jsonError(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  status: number,
  headers?: HeadersInit,
): Response {
  const body: ApiErrorEnvelope = { error: { code, message, requestId } };
  return Response.json(body, { headers: responseHeaders(requestId, headers), status });
}

export async function readJsonBody(
  request: Request,
  maximumBytes = maxJsonBodyBytes,
): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new RequestBodyError("unsupported_media_type", "JSON content is required.", 415);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new RequestBodyError("payload_too_large", "Request body is too large.", 413);
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maximumBytes) {
    throw new RequestBodyError("payload_too_large", "Request body is too large.", 413);
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    throw new RequestBodyError("bad_request", "Request body is not valid JSON.", 400);
  }
}

export class RequestBodyError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
