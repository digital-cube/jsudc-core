import { describe, expect, it, vi } from "vitest";
import { UdcClient } from "../src/client.js";
import { type ChangeEvent, isUnauthenticated, UdcError } from "../src/index.js";

const encoder = new TextEncoder();

/** One scripted answer of the stub: a status, and the chunks the body delivers (then it ends or hangs). */
interface Scripted {
  status?: number;
  body?: unknown;
  chunks?: string[];
  /** Keep the stream open after the chunks (until the request is aborted). */
  hang?: boolean;
}

interface Call {
  url: string;
  init: RequestInit;
}

/** A `fetch` that answers the scripted responses in order, recording each request. */
function stubFetch(script: Scripted[]) {
  const calls: Call[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = script.shift();
    if (!next) throw new Error("no more scripted answers");
    if (next.body !== undefined) {
      return new Response(JSON.stringify(next.body), {
        status: next.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
    const signal = init?.signal;
    const stream = new ReadableStream<Uint8Array>({
      start(ctl) {
        for (const c of next.chunks ?? []) ctl.enqueue(encoder.encode(c));
        if (!next.hang) {
          ctl.close();
          return;
        }
        signal?.addEventListener("abort", () => ctl.error(signal.reason), { once: true });
      },
    });
    return new Response(stream, {
      status: next.status ?? 200,
      headers: { "content-type": "text/event-stream" },
    });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const ready = 'retry: 5\nevent: ready\ndata: {"collections":["tasks"]}\n\n';
const change = (e: ChangeEvent) => `event: change\ndata: ${JSON.stringify(e)}\n\n`;

describe("UdcClient.changes", () => {
  it("opens GET /udc/changes with the headers function, credentials and the collections", async () => {
    const { impl, calls } = stubFetch([{ chunks: [ready], hang: true }]);
    let n = 0;
    const client = new UdcClient({
      httpUrl: "http://api.test/",
      headers: async () => ({ authorization: `Bearer t${++n}` }),
      credentials: "include",
      fetch: impl,
    });
    const ctl = new AbortController();
    const done = client.changes({
      collections: ["tasks", "notes"],
      onChange: () => {},
      onOpen: () => ctl.abort(),
      signal: ctl.signal,
    });
    await expect(done).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe("http://api.test/udc/changes?collections=tasks%2Cnotes");
    expect(call?.init.method).toBe("GET");
    expect(call?.init.credentials).toBe("include");
    expect(call?.init.headers).toMatchObject({
      accept: "text/event-stream",
      authorization: "Bearer t1",
    });
  });

  it("parses change events, also when a chunk splits one in the middle", async () => {
    const a = change({ collection: "tasks", op: "insert", ids: ["1"] });
    const b = change({ collection: "tasks", op: "delete" });
    const { impl } = stubFetch([
      {
        chunks: [
          ready,
          ": hb\n\n",
          a.slice(0, 9),
          a.slice(9, 30),
          a.slice(30) + b.slice(0, 5),
          b.slice(5),
        ],
        hang: true,
      },
    ]);
    const client = new UdcClient({ httpUrl: "", fetch: impl });
    const ctl = new AbortController();
    const got: ChangeEvent[] = [];
    await client.changes({
      collections: ["tasks"],
      onChange: (e) => {
        got.push(e);
        if (got.length === 2) ctl.abort();
      },
      signal: ctl.signal,
    });
    expect(got).toEqual([
      { collection: "tasks", op: "insert", ids: ["1"] },
      { collection: "tasks", op: "delete" },
    ]);
  });

  it("skips data that is not a change event", async () => {
    const { impl } = stubFetch([
      {
        chunks: [
          ready,
          "event: change\ndata: not json\n\n",
          'event: change\ndata: {"collection":"t","op":"upsert"}\n\n',
          'event: other\ndata: {"collection":"t","op":"insert"}\n\n',
          change({ collection: "t", op: "update" }),
        ],
        hang: true,
      },
    ]);
    const client = new UdcClient({ httpUrl: "", fetch: impl });
    const ctl = new AbortController();
    const got: ChangeEvent[] = [];
    await client.changes({
      collections: ["t"],
      onChange: (e) => {
        got.push(e);
        ctl.abort();
      },
      signal: ctl.signal,
    });
    expect(got).toEqual([{ collection: "t", op: "update" }]);
  });

  it("reconnects after the stream ends or the network fails, reports reconnected, re-reads the headers", async () => {
    const { impl, calls } = stubFetch([
      { chunks: [ready, change({ collection: "t", op: "insert", ids: ["a"] })] },
      { status: 502, chunks: [] },
      { chunks: [ready, change({ collection: "t", op: "insert", ids: ["b"] })], hang: true },
    ]);
    let n = 0;
    const client = new UdcClient({
      httpUrl: "",
      headers: () => ({ "x-csrf": `c${++n}` }),
      fetch: impl,
    });
    const ctl = new AbortController();
    const opens: boolean[] = [];
    const errors: { attempt: number; delayMs: number }[] = [];
    const got: string[] = [];
    await client.changes({
      collections: ["t"],
      onChange: (e) => {
        got.push(e.ids?.[0] ?? "");
        if (got.length === 2) ctl.abort();
      },
      onOpen: ({ reconnected }) => opens.push(reconnected),
      onError: (_err, info) => errors.push(info),
      signal: ctl.signal,
      maxDelayMs: 20,
    });
    expect(got).toEqual(["a", "b"]);
    expect(opens).toEqual([false, true]);
    // The stream end, then the 502: two failed attempts, the backoff grows.
    expect(errors.map((e) => e.attempt)).toEqual([1, 2]);
    for (const e of errors) expect(e.delayMs).toBeLessThanOrEqual(20);
    expect(calls.map((c) => (c.init.headers as Record<string, string>)["x-csrf"])).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
  });

  it("retries a fetch that throws", async () => {
    const { impl } = stubFetch([{ chunks: [ready], hang: true }]);
    let first = true;
    const flaky = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (first) {
        first = false;
        throw new TypeError("network down");
      }
      return impl(input, init);
    }) as typeof fetch;
    const client = new UdcClient({ httpUrl: "", fetch: flaky });
    const ctl = new AbortController();
    const errors: unknown[] = [];
    await client.changes({
      collections: ["t"],
      onChange: () => {},
      onOpen: () => ctl.abort(),
      onError: (err) => errors.push(err),
      signal: ctl.signal,
      minDelayMs: 1,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(TypeError);
  });

  it("reopens a stream that goes idle", async () => {
    const { impl, calls } = stubFetch([
      { chunks: [ready], hang: true },
      { chunks: [ready], hang: true },
    ]);
    const client = new UdcClient({ httpUrl: "", fetch: impl });
    const ctl = new AbortController();
    const opens: boolean[] = [];
    const errors: unknown[] = [];
    await client.changes({
      collections: ["t"],
      onChange: () => {},
      onOpen: ({ reconnected }) => {
        opens.push(reconnected);
        if (reconnected) ctl.abort();
      },
      onError: (err) => errors.push(err),
      signal: ctl.signal,
      minDelayMs: 1,
      idleTimeoutMs: 30,
    });
    expect(opens).toEqual([false, true]);
    expect(calls).toHaveLength(2);
    expect(String((errors[0] as Error).message)).toMatch(/idle/);
  });

  it("stops with the unauthenticated error on HTTP 401", async () => {
    const { impl, calls } = stubFetch([{ status: 401, body: { error: "no" } }]);
    const client = new UdcClient({ httpUrl: "", fetch: impl });
    const err = await client.changes({ collections: ["t"], onChange: () => {} }).catch((e) => e);
    expect(isUnauthenticated(err)).toBe(true);
    expect((err as UdcError).details).toMatchObject({ http_status: 401 });
    expect(calls).toHaveLength(1);
  });

  it("stops on 403 / 404 / 400 with the server's error payload, or a plain code", async () => {
    const { impl } = stubFetch([
      { status: 404, body: { code: "not_found", message: "unknown collection: x" } },
      { status: 403, body: "nope" },
      { status: 400, body: { error: "collections is required" } },
    ]);
    const client = new UdcClient({ httpUrl: "", fetch: impl });
    const run = () => client.changes({ collections: ["x"], onChange: () => {} }).catch((e) => e);
    const notFound = (await run()) as UdcError;
    expect(notFound).toBeInstanceOf(UdcError);
    expect(notFound.code).toBe("not_found");
    expect(notFound.message).toBe("unknown collection: x");
    expect(notFound.details).toMatchObject({ http_status: 404 });
    const forbidden = (await run()) as UdcError;
    expect(forbidden.code).toBe("forbidden");
    expect(isUnauthenticated(forbidden)).toBe(false);
    expect(((await run()) as UdcError).code).toBe("validation_error");
  });

  it("resolves at once with an aborted signal, and while waiting to reconnect", async () => {
    const { impl, calls } = stubFetch([{ status: 500, chunks: [] }]);
    const client = new UdcClient({ httpUrl: "", fetch: impl });
    const pre = new AbortController();
    pre.abort();
    await client.changes({ collections: ["t"], onChange: () => {}, signal: pre.signal });
    expect(calls).toHaveLength(0);

    const ctl = new AbortController();
    const done = client.changes({
      collections: ["t"],
      onChange: () => {},
      onError: () => setTimeout(() => ctl.abort(), 5),
      signal: ctl.signal,
      minDelayMs: 60_000,
    });
    await expect(done).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("takes the server's retry: hint as the first delay", async () => {
    const { impl } = stubFetch([
      { chunks: ["retry: 7\n\n", ready.replace("retry: 5\n", "")] },
      { chunks: [ready], hang: true },
    ]);
    const client = new UdcClient({ httpUrl: "", fetch: impl });
    const ctl = new AbortController();
    const delays: number[] = [];
    await client.changes({
      collections: ["t"],
      onChange: () => {},
      onOpen: ({ reconnected }) => reconnected && ctl.abort(),
      onError: (_e, { delayMs }) => delays.push(delayMs),
      signal: ctl.signal,
    });
    expect(delays).toHaveLength(1);
    expect(delays[0]).toBeGreaterThanOrEqual(3);
    expect(delays[0]).toBeLessThanOrEqual(7);
  });
});
