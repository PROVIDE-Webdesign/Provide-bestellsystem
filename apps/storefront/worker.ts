import handler from "vinext/server/fetch-handler";
import { secureHttpResponse } from "@provide/contracts";

export default {
  ...handler,
  fetch(
    request: Request,
    env: Record<string, unknown> & { ASSETS: { fetch(request: Request): Promise<Response> } },
    context: Parameters<typeof handler.fetch>[2],
  ) {
    return secureHttpResponse(
      request,
      typeof env.APP_ENV === "string" ? env.APP_ENV : undefined,
      () => handler.fetch(request, env, context),
      env.ASSETS,
    );
  },
};
