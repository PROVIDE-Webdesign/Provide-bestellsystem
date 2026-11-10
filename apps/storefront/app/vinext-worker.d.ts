// The installed Vinext fetch-handler declaration refers to this generated Vite module.
declare module "virtual:vinext-worker-entry" {
  interface WorkerContext {
    waitUntil(promise: Promise<unknown>): void;
    passThroughOnException(): void;
  }
  const handler: {
    fetch(
      request: Request,
      env: Record<string, unknown>,
      context: WorkerContext,
    ): Promise<Response>;
  };
  export default handler;
}
