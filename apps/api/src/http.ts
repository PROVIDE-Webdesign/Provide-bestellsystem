import { readCheckoutBody, CheckoutBodyError } from "@provide/contracts";
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
  try {
    return JSON.parse(await readCheckoutBody(request, maximumBytes)) as unknown;
  } catch (error) {
    if (error instanceof CheckoutBodyError)
      throw new RequestBodyError(
        error.status === 413
          ? "payload_too_large"
          : error.status === 415
            ? "unsupported_media_type"
            : "bad_request",
        error.message,
        error.status,
      );
    throw error;
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
