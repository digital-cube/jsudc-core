import { describe, expect, it, vi } from "vitest";
import { MESSAGE_ID_HEADER, UdcClient } from "../src/client.js";
import { isUnauthenticated, UdcError } from "../src/index.js";

/** A `fetch` that answers every call with `res()` and records the `init` it got. */
function recordingFetch(res: () => Response | Promise<Response>) {
  const inits: RequestInit[] = [];
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    inits.push(init ?? {});
    return res();
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, inits, mock: fetch };
}

const okDescribe = () =>
  new Response(JSON.stringify({ kind: "udc.describe.ok", id: "", payload: { collection: "c" } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const status = (code: number) => () => new Response("refused", { status: code });

const headersOf = (init: RequestInit | undefined) =>
  (init?.headers ?? {}) as Record<string, string>;

describe("UdcClient headers as a function", () => {
  it("calls the function for every request and sends what it returns", async () => {
    let token = 0;
    const headers = vi.fn(() => ({ "x-csrf-token": `t${++token}` }));
    const { fetch, inits } = recordingFetch(okDescribe);
    const client = new UdcClient({ httpUrl: "", headers, fetch });

    await client.describe("c");
    await client.describe("c");

    expect(headers).toHaveBeenCalledTimes(2);
    expect(headersOf(inits[0])["x-csrf-token"]).toBe("t1");
    expect(headersOf(inits[1])["x-csrf-token"]).toBe("t2");
    expect(headersOf(inits[1])[MESSAGE_ID_HEADER]).toBeTruthy();
    expect(headersOf(inits[1])["content-type"]).toBe("application/json");
  });

  it("awaits an async function", async () => {
    const headers = async () => {
      await new Promise((r) => setTimeout(r, 1));
      return { authorization: "Bearer later" };
    };
    const { fetch, inits } = recordingFetch(okDescribe);
    await new UdcClient({ httpUrl: "", headers, fetch }).describe("c");
    expect(headersOf(inits[0]).authorization).toBe("Bearer later");
  });

  it("still takes a plain object", async () => {
    const { fetch, inits } = recordingFetch(okDescribe);
    await new UdcClient({ httpUrl: "", headers: { "x-a": "1" }, fetch }).describe("c");
    expect(headersOf(inits[0])["x-a"]).toBe("1");
  });

  it("does not fetch when the headers function throws", async () => {
    const { fetch, mock } = recordingFetch(okDescribe);
    const client = new UdcClient({
      httpUrl: "",
      headers: () => {
        throw new Error("no token");
      },
      fetch,
    });
    await expect(client.describe("c")).rejects.toThrow("no token");
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("UdcClient credentials", () => {
  it("passes credentials to fetch when given", async () => {
    const { fetch, inits } = recordingFetch(okDescribe);
    await new UdcClient({ httpUrl: "", credentials: "include", fetch }).describe("c");
    expect(inits[0]?.credentials).toBe("include");
  });

  it("leaves credentials out when not given", async () => {
    const { fetch, inits } = recordingFetch(okDescribe);
    await new UdcClient({ httpUrl: "", fetch }).describe("c");
    expect(inits[0] && "credentials" in inits[0]).toBe(false);
  });
});

describe("UdcClient HTTP refusals", () => {
  it("maps HTTP 401 to the unauthenticated forbidden error", async () => {
    const { fetch } = recordingFetch(status(401));
    const err = await new UdcClient({ httpUrl: "", fetch }).describe("c").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UdcError);
    expect((err as UdcError).code).toBe("forbidden");
    expect((err as UdcError).details).toEqual({ reason: "unauthenticated", http_status: 401 });
    expect(isUnauthenticated(err)).toBe(true);
    expect((err as UdcError).message).toBe("udc.describe: HTTP 401");
  });

  it("maps HTTP 403 to forbidden, not unauthenticated", async () => {
    const { fetch } = recordingFetch(status(403));
    const err = await new UdcClient({ httpUrl: "", fetch }).describe("c").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UdcError);
    expect((err as UdcError).code).toBe("forbidden");
    expect((err as UdcError).details).toEqual({ http_status: 403 });
    expect(isUnauthenticated(err)).toBe(false);
  });

  it("keeps HTTP 500 a plain Error", async () => {
    const { fetch } = recordingFetch(status(500));
    const err = await new UdcClient({ httpUrl: "", fetch }).describe("c").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UdcError);
    expect((err as Error).message).toBe("udc.describe: HTTP 500");
  });

  it("keeps a network failure a plain Error", async () => {
    const { fetch } = recordingFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const err = await new UdcClient({ httpUrl: "", fetch }).describe("c").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(UdcError);
  });
});
