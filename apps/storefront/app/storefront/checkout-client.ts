import { parseCheckoutIntent, record, type CheckoutIntent } from "@provide/contracts";
export class CheckoutClientError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: number | null = null,
    readonly code = "service_unavailable",
  ) {
    super(
      status === 429
        ? `Bitte warte ${retryAfter ?? 1} Sekunden und versuche es bewusst erneut.`
        : status === 410
          ? "Der Bestellversuch ist abgelaufen. Prüfe zuerst den bisherigen Bestellstatus oder kontaktiere das Restaurant."
          : status === 403
            ? "Die Sicherheitsprüfung konnte nicht bestätigt werden. Cookies müssen für diese Seite erlaubt sein."
            : "Der Bestellversuch konnte gerade nicht geprüft werden. Dein Warenkorb bleibt erhalten.",
    );
  }
}
/** Stores only public intent metadata. It never persists a contact, address, verifier or CSRF token. */
export class CheckoutClient {
  private csrf: string | null = null;
  private boot: Promise<void> | null = null;
  private intent: CheckoutIntent | null = null;
  private mustCheck = false;
  private storageWarning = false;
  private issueAttempt: {
    issueId: string;
    challenge: string;
    submissionKey: string;
    renewSessionId?: string;
  } | null = null;
  readonly storageKey: string;
  private readonly fetcher: typeof fetch;
  constructor(
    readonly base: string,
    fetcher: typeof fetch = fetch,
    private readonly storage: Storage | null = null,
  ) {
    this.fetcher = fetcher.bind(globalThis);
    this.storageKey = `provide-checkout-intent:${base}`;
    try {
      const raw = storage?.getItem(this.storageKey);
      if (raw) {
        this.mustCheck = true;
        const saved = record(JSON.parse(raw));
        this.intent = saved?.scope === base ? (parseCheckoutIntent(saved.intent) ?? null) : null;
        this.mustCheck = true;
        if (!this.intent) this.storageWarning = true;
      }
    } catch {
      this.storageWarning = true;
    }
  }
  get currentIntent(): CheckoutIntent | null {
    return this.intent;
  }
  get needsReceipt(): boolean {
    return this.mustCheck;
  }
  get persistenceWarning(): boolean {
    return this.storageWarning;
  }
  async bootstrap(): Promise<void> {
    if (this.csrf) return;
    if (this.boot) return this.boot;
    this.boot = (async () => {
      const response = await this.fetcher(this.base + "/checkout-context", {
        method: "POST",
        headers: { "content-type": "application/json", "x-provide-checkout-bootstrap": "1" },
        body: "{}",
        cache: "no-store",
      });
      if (!response.ok) throw await this.error(response);
      const data = record(record(await response.json())?.data);
      if (
        data?.ready !== true ||
        typeof data.csrf !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(data.csrf)
      )
        throw new CheckoutClientError(503);
      this.csrf = data.csrf;
    })().finally(() => {
      this.boot = null;
    });
    return this.boot;
  }
  async request(resource: string, init: RequestInit): Promise<Response> {
    await this.bootstrap();
    const headers = new Headers(init.headers);
    headers.set("x-provide-checkout-csrf", this.csrf!);
    return this.fetcher(this.base + "/" + resource, {
      ...init,
      headers,
      cache: "no-store",
      credentials: "same-origin",
    });
  }
  async issue(challenge: string, issueId: string, renew = false): Promise<CheckoutIntent> {
    if (this.mustCheck) throw new CheckoutClientError(409, null, "checkout_result_unknown");
    const previous = this.intent;
    if (previous && !renew && Date.parse(previous.writeExpiresAt) > Date.now()) return previous;
    if (previous && !renew) throw new CheckoutClientError(410);
    if (!this.issueAttempt || this.issueAttempt.issueId !== issueId)
      this.issueAttempt = {
        issueId,
        challenge,
        submissionKey: crypto.randomUUID(),
        ...(renew && previous ? { renewSessionId: previous.sessionId } : {}),
      };
    if (this.issueAttempt.challenge !== challenge) throw new CheckoutClientError(409);
    const attempt = this.issueAttempt;
    // Keep this exact issue payload available to the caller on uncertain transport/provider results.
    const response = await this.request("checkout-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(attempt),
    });
    if (!response.ok) throw await this.error(response);
    const intent = parseCheckoutIntent(record(await response.json())?.data);
    if (!intent) throw new CheckoutClientError(503);
    this.intent = intent;
    this.issueAttempt = null;
    this.mustCheck = false;
    this.save();
    return intent;
  }
  async receipt(): Promise<unknown> {
    if (!this.intent) throw new CheckoutClientError(410);
    const response = await this.request("checkout-receipt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: this.intent.sessionId,
        submissionKey: this.intent.submissionKey,
      }),
    });
    if (!response.ok) {
      this.mustCheck = true;
      throw await this.error(response);
    }
    const result = record(record(await response.json())?.data);
    if (result?.state !== "unsubmitted" && result?.state !== "committed")
      throw new CheckoutClientError(503);
    this.mustCheck = false;
    return result;
  }
  async submit(
    resource: string,
    command: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Response> {
    if (!this.intent || this.mustCheck || Date.parse(this.intent.writeExpiresAt) <= Date.now())
      throw new CheckoutClientError(
        this.mustCheck ? 409 : 410,
        null,
        this.mustCheck ? "checkout_result_unknown" : "checkout_session_expired",
      );
    this.mustCheck = true;
    this.save();
    return this.request(resource, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: this.intent.sessionId,
        command: { ...command, submissionKey: this.intent.submissionKey },
      }),
      ...(signal ? { signal } : {}),
    });
  }
  complete(): void {
    this.intent = null;
    this.mustCheck = false;
    try {
      this.storage?.removeItem(this.storageKey);
    } catch {
      this.storageWarning = true;
    }
  }
  private save(): void {
    try {
      if (this.intent)
        this.storage?.setItem(
          this.storageKey,
          JSON.stringify({ scope: this.base, intent: this.intent }),
        );
    } catch {
      this.storageWarning = true;
    }
  }
  async error(response: Response): Promise<CheckoutClientError> {
    const raw = response.headers.get("retry-after");
    let code = "service_unavailable";
    try {
      const e = record(record(await response.clone().json())?.error);
      if (typeof e?.code === "string") code = e.code;
    } catch {
      /* neutral */
    }
    return new CheckoutClientError(
      response.status,
      raw && /^[1-9][0-9]{0,2}$/.test(raw) && Number(raw) <= 600 ? Number(raw) : null,
      code,
    );
  }
}
