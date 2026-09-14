export interface RequestContext {
  readonly requestId: string;
}

export function createRequestContext(): RequestContext {
  return { requestId: crypto.randomUUID() };
}
