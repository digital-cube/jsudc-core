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
