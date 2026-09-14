import type { RequestContext } from "./context.js";

export interface ApiLogger {
  error(context: RequestContext, event: string): void;
}

export const consoleLogger: ApiLogger = {
  error(context, event) {
    console.error(JSON.stringify({ event, requestId: context.requestId }));
  },
};
