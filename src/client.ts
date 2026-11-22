import {
  CHANGE_EVENT,
  CHANGES_READY_EVENT,
  CHANGES_ROUTE,
  type ChangeEvent,
  ChangeEventSchema,
  SseParser,
} from "./changes.js";
import {
  type ActionName,
  type ActionRequest,
  type ActionResponse,
  ErrorPayloadSchema,
  errKind,
  type HostAction,
  type HostActionPayload,
  type HostActionResponse,
  okKind,
  UdcError,
  unauthenticatedError,
} from "./index.js";

export const MESSAGE_ID_HEADER = "x-udc-message-id";

/**
 * Headers for every request: a fixed object, or a function the client calls
 * before each request (sync or async), e.g. to read a CSRF token that changes
 * with the session.
 */
export type UdcHeaders =
  | Record<string, string>
  | (() => Record<string, string> | Promise<Record<string, string>>);

export interface UdcClientOptions {
  /** Backend base URL, without `/udc`. `""` means same origin (the Vite proxy). */
  httpUrl: string;
  /**
   * Sent with every request, e.g. an auth or CSRF header. A function is
   * evaluated per call, so a token that changes needs no new client.
   */
  headers?: UdcHeaders;
  /**
   * Passed to `fetch` as `credentials` when given, e.g. `"include"` to send a
   * cookie session to another origin. Left out, `fetch` uses its default.
   */
  credentials?: RequestCredentials;
  /** Injected in tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/** `never` for a built-in action name, so `call`'s by-name escape hatch cannot bypass its types. */
type NotBuiltin<N extends string> = N extends ActionName ? never : unknown;

export interface CallOptions {
  signal?: AbortSignal;
}

/** What `UdcClient.changes` is called with. */
export interface ChangesOptions {
  /** The collections to be told about; the server checks access and scope for each. */
  collections: readonly string[];
  /** One change the stream delivered, already parsed (`ChangeEvent`). */
  onChange(event: ChangeEvent): void;
  /**
   * The stream is subscribed (the server's `ready` event). `reconnected` is
   * `true` from the second time on: changes made while the stream was down
   * were not sent (there is no replay), so refetch what is shown.
   */
  onOpen?(info: { reconnected: boolean }): void;
  /**
   * The connection failed or the stream ended; the next attempt follows in
   * `delayMs`. For logs and a "reconnecting" badge; the method keeps going.
   */
  onError?(err: unknown, info: { attempt: number; delayMs: number }): void;
  /** Aborting it closes the stream and resolves the call. */
  signal?: AbortSignal;
  /**
   * The first wait before a reconnect, doubled per failed attempt up to
   * `maxDelayMs`, with jitter. Default 1000 ms, or the server's `retry:` hint.
   */
  minDelayMs?: number;
  /** The longest wait between attempts. Default 30 000 ms. */
  maxDelayMs?: number;
  /**
   * A stream that delivers nothing, not even the server's heartbeat, for
   * this long is taken for dead and reopened (a proxy that dropped the
   * connection without closing it). Default 45 000 ms; `0` turns it off.
   */
  idleTimeoutMs?: number;
}

const DEFAULT_MIN_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 45_000;

/** Wait `ms`, or less when `signal` aborts. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** The refusal an answer that is not a stream stands for, or `null` when it is worth retrying. */
async function refusal(res: Response): Promise<UdcError | null> {
  if (res.status === 401) {
    return unauthenticatedError("udc.changes: HTTP 401", { http_status: 401 });
  }
  if (![400, 403, 404].includes(res.status)) return null;
  const body = await res.json().catch(() => null);
  const err = ErrorPayloadSchema.safeParse(body);
  if (err.success) {
    return UdcError.fromPayload({
      ...err.data,
      details: { ...err.data.details, http_status: res.status },
    });
  }
  const code =
    res.status === 403 ? "forbidden" : res.status === 404 ? "not_found" : "validation_error";
  return new UdcError(code, `udc.changes: HTTP ${res.status}`, { http_status: res.status });
}

function messageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Insecure origins have no randomUUID; the id only correlates log lines.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/**
 * The UDC envelope RPC over HTTP: one `POST ${httpUrl}/udc/<action>` per
 * call. Answers `.ok` with the payload and throws `UdcError` on `.err`.
 * Transport failures (network, a non-200 from a proxy) throw a plain `Error`,
 * which the query client may retry; a `UdcError` it never retries. An HTTP
 * 401 / 403 from whatever stands in front of `/udc` is a refusal, not a
 * transport failure: 401 throws the same `UdcError` as an in-protocol
 * "not signed in" (`forbidden`, `details.reason: "unauthenticated"`), 403 a
 * plain `forbidden`; both carry `details.http_status`.
 */
export class UdcClient {
  readonly httpUrl: string;
  private readonly headers: UdcHeaders;
  private readonly credentials: RequestCredentials | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: UdcClientOptions) {
    this.httpUrl = opts.httpUrl.replace(/\/+$/, "");
    this.headers = opts.headers ?? {};
    this.credentials = opts.credentials;
    this.fetchImpl = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  /** A built-in action (`ACTIONS`), typed per action. */
  call<A extends ActionName>(
    action: A,
    payload: ActionRequest<A>,
    opts?: CallOptions,
  ): Promise<ActionResponse<A>>;
  /**
   * A host action (`defineHostAction`): the payload typed from its request
   * schema, the answer parsed with its response schema (an answer that does
   * not parse throws `UdcError` `internal`).
   */
  call<H extends HostAction>(
    action: H,
    payload: HostActionPayload<H>,
    opts?: CallOptions,
  ): Promise<HostActionResponse<H>>;
  /**
   * Any other action by name, typed by the caller (`call<Res, Req>(name, …)`):
   * the escape hatch for an action without a shared definition. The answer
   * is not checked. A built-in name does not match here.
   */
  call<Res = unknown, Req = Record<string, unknown>, N extends string = string>(
    action: N & NotBuiltin<N>,
    payload: Req,
    opts?: CallOptions,
  ): Promise<Res>;
  async call(
    target: string | HostAction,
    payload: unknown,
    opts: CallOptions = {},
  ): Promise<unknown> {
    const action = typeof target === "string" ? target : target.name;
    const answer = await this.send(action, payload, opts);
    if (typeof target === "string") return answer;
    const parsed = target.response.safeParse(answer);
    if (!parsed.success) {
      throw new UdcError("internal", `udc.${action}: the answer does not match its schema`, {
        issues: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  private async send(action: string, payload: unknown, opts: CallOptions): Promise<unknown> {
    const extra = typeof this.headers === "function" ? await this.headers() : this.headers;
    const res = await this.fetchImpl(`${this.httpUrl}/udc/${action}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [MESSAGE_ID_HEADER]: messageId(),
        ...extra,
      },
      body: JSON.stringify(payload),
      ...(this.credentials !== undefined ? { credentials: this.credentials } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (res.status === 401) {
      throw unauthenticatedError(`udc.${action}: HTTP 401`, { http_status: 401 });
    }
    if (res.status === 403) {
      throw new UdcError("forbidden", `udc.${action}: HTTP 403`, { http_status: 403 });
    }
    if (!res.ok) throw new Error(`udc.${action}: HTTP ${res.status}`);

    const envelope = (await res.json()) as { kind?: unknown; payload?: unknown };
    if (envelope.kind === okKind(action)) return envelope.payload;
    if (envelope.kind === errKind(action)) {
      const err = ErrorPayloadSchema.safeParse(envelope.payload);
      throw err.success
        ? UdcError.fromPayload(err.data)
        : new UdcError("internal", `udc.${action}: malformed error payload`);
    }
    throw new UdcError("internal", `udc.${action}: unexpected reply kind ${String(envelope.kind)}`);
  }

  /**
   * Open the change feed for `collections` (`capabilities.changes`) and call
   * `onChange` for every change until `signal` aborts. One `GET
   * ${httpUrl}/udc/changes` read with `fetch` as a stream, so the client's
   * `headers` (evaluated per connection) and `credentials` apply as to any
   * call. A dropped connection is retried with exponential backoff and
   * reported through `onOpen({reconnected: true})` once it is back.
   *
   * Resolves when `signal` aborts. Rejects, without retrying, when the server
   * refuses: HTTP 401 with the "not signed in" `UdcError`
   * (`isUnauthenticated`), 403 `forbidden`, 404 `not_found` (a collection
   * this request may not see), 400 `validation_error`.
   */
  async changes(opts: ChangesOptions): Promise<void> {
    const { signal } = opts;
    const maxDelay = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    let baseDelay = opts.minDelayMs ?? DEFAULT_MIN_DELAY_MS;
    const query = new URLSearchParams({ collections: opts.collections.join(",") });
    const url = `${this.httpUrl}${CHANGES_ROUTE}?${query.toString()}`;
    const idleTimeout = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    let opened = 0;
    let attempt = 0;
    while (!signal?.aborted) {
      let failure: unknown;
      // One controller per attempt: the caller's abort, or the idle timer, ends it.
      const attemptCtl = new AbortController();
      const stop = () => attemptCtl.abort(signal?.reason);
      signal?.addEventListener("abort", stop, { once: true });
      let idle: ReturnType<typeof setTimeout> | undefined;
      const touch = () => {
        if (idleTimeout <= 0) return;
        clearTimeout(idle);
        idle = setTimeout(
          () => attemptCtl.abort(new Error("udc.changes: the stream went idle")),
          idleTimeout,
        );
      };
      try {
        const extra = typeof this.headers === "function" ? await this.headers() : this.headers;
        touch();
        const res = await this.fetchImpl(url, {
          method: "GET",
          headers: { accept: "text/event-stream", ...extra },
          ...(this.credentials !== undefined ? { credentials: this.credentials } : {}),
          signal: attemptCtl.signal,
        });
        const refused = await refusal(res);
        if (refused) throw refused;
        if (!res.ok || !res.body) throw new Error(`udc.changes: HTTP ${res.status}`);
        const parser = new SseParser();
        const decoder = new TextDecoder();
        const reader = res.body.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            touch();
            for (const msg of parser.push(decoder.decode(value, { stream: true }))) {
              if (msg.retry !== undefined && opts.minDelayMs === undefined) baseDelay = msg.retry;
              if (msg.event === CHANGES_READY_EVENT) {
                attempt = 0;
                opts.onOpen?.({ reconnected: opened > 0 });
                opened += 1;
              } else if (msg.event === CHANGE_EVENT) {
                const event = parseChange(msg.data);
                if (event) opts.onChange(event);
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
        failure = new Error("udc.changes: the stream ended");
      } catch (err) {
        if (signal?.aborted) return;
        if (err instanceof UdcError) throw err;
        failure = attemptCtl.signal.aborted ? attemptCtl.signal.reason : err;
      } finally {
        clearTimeout(idle);
        signal?.removeEventListener("abort", stop);
        attemptCtl.abort();
      }
      if (signal?.aborted) return;
      attempt += 1;
      const ceiling = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
      // Jitter, so the clients of a restarted server do not all come back at once.
      const delayMs = Math.round(ceiling * (0.5 + Math.random() / 2));
      opts.onError?.(failure, { attempt, delayMs });
      await pause(delayMs, signal);
    }
  }

  collections() {
    return this.call("collections", {});
  }

  describe(collection: string) {
    return this.call("describe", { collection });
  }

  list(req: ActionRequest<"list">, opts?: CallOptions) {
    return this.call("list", req, opts);
  }

  read(collection: string, id: string) {
    return this.call("read", { collection, id });
  }

  mutate(req: ActionRequest<"mutate">) {
    return this.call("mutate", req);
  }

  /** Change or delete many rows in one request (`capabilities.mutate_many`). */
  mutateMany(req: ActionRequest<"mutate_many">) {
    return this.call("mutate_many", req);
  }

  reindex(req: ActionRequest<"reindex">) {
    return this.call("reindex", req);
  }

  treeReparent(req: ActionRequest<"tree.reparent">) {
    return this.call("tree.reparent", req);
  }

  schemaAddField(req: ActionRequest<"schema.add_field">) {
    return this.call("schema.add_field", req);
  }

  schemaUpdateField(req: ActionRequest<"schema.update_field">) {
    return this.call("schema.update_field", req);
  }

  schemaSoftDeleteField(req: ActionRequest<"schema.soft_delete_field">) {
    return this.call("schema.soft_delete_field", req);
  }

  /** The file a `source_yaml` collection is read from, as written. */
  sourceRead(collection: string) {
    return this.call("source.read", { collection });
  }
}

/** A `change` event's data, or `null` when it is not one (skipped, never fatal). */
function parseChange(data: string): ChangeEvent | null {
  try {
    const parsed = ChangeEventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
