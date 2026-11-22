import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { UdcClient } from "../src/client.js";
import {
  defineHostAction,
  type HostActionPayload,
  type HostActionRequest,
  type HostActionResponse,
  isHostAction,
  UdcError,
} from "../src/index.js";

const archive = defineHostAction({
  name: "mail.archive_thread",
  request: z.object({ thread_id: z.string(), notify: z.boolean().default(false) }),
  response: z.object({ archived: z.number().int(), at: z.string().default("now") }),
});

function stubFetch(reply: (action: string, body: unknown) => unknown) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const action = String(input).split("/udc/")[1] ?? "";
    const payload = reply(action, JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify({ kind: `udc.${action}.ok`, id: "", payload }));
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, mock: fetch };
}

describe("defineHostAction", () => {
  it("keeps the name and both schemas, frozen", () => {
    expect(archive.name).toBe("mail.archive_thread");
    expect(archive.request.parse({ thread_id: "t" })).toEqual({ thread_id: "t", notify: false });
    expect(Object.isFrozen(archive)).toBe(true);
    expect(isHostAction(archive)).toBe(true);
    expect(isHostAction({ name: "x" })).toBe(false);
    expect(isHostAction("x")).toBe(false);
  });

  it("refuses a bad name and a built-in one", () => {
    const schemas = { request: z.object({}), response: z.object({}) };
    expect(() => defineHostAction({ name: "a/b", ...schemas })).toThrow(/invalid action name/);
    expect(() => defineHostAction({ name: "", ...schemas })).toThrow(/invalid action name/);
    expect(() => defineHostAction({ name: "mutate", ...schemas })).toThrow(/built-in/);
    expect(() => defineHostAction({ name: "mutate_many", ...schemas })).toThrow(/built-in/);
  });

  it("types the payload as the request's input and the handler's view as its output", () => {
    expectTypeOf<HostActionPayload<typeof archive>>().toEqualTypeOf<{
      thread_id: string;
      notify?: boolean | undefined;
    }>();
    expectTypeOf<HostActionRequest<typeof archive>>().toEqualTypeOf<{
      thread_id: string;
      notify: boolean;
    }>();
    expectTypeOf<HostActionResponse<typeof archive>>().toEqualTypeOf<{
      archived: number;
      at: string;
    }>();
  });
});

describe("UdcClient.call with a host action", () => {
  it("posts to udc/<name> and parses the answer with the response schema", async () => {
    const { fetch, mock } = stubFetch(() => ({ archived: 3 }));
    const client = new UdcClient({ httpUrl: "http://h", fetch });
    const res = await client.call(archive, { thread_id: "t1" });
    expectTypeOf(res).toEqualTypeOf<{ archived: number; at: string }>();
    expect(res).toEqual({ archived: 3, at: "now" });
    expect(String(mock.mock.calls[0]?.[0])).toBe("http://h/udc/mail.archive_thread");
    expect(JSON.parse(String(mock.mock.calls[0]?.[1]?.body))).toEqual({ thread_id: "t1" });
  });

  it("throws UdcError internal when the answer does not match", async () => {
    const { fetch } = stubFetch(() => ({ archived: "three" }));
    const client = new UdcClient({ httpUrl: "", fetch });
    const err = await client.call(archive, { thread_id: "t1" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UdcError);
    expect(err).toMatchObject({ code: "internal" });
  });

  it("checks the payload type at compile time", () => {
    const client = new UdcClient({ httpUrl: "", fetch: stubFetch(() => ({})).fetch });
    const never = () => {
      // @ts-expect-error thread_id is a string
      void client.call(archive, { thread_id: 1 });
      // @ts-expect-error thread_id is required
      void client.call(archive, {});
    };
    expect(typeof never).toBe("function");
  });
});

describe("UdcClient.call by name", () => {
  it("is the escape hatch, typed by the caller, the answer unchecked", async () => {
    const { fetch, mock } = stubFetch(() => ({ pong: true }));
    const client = new UdcClient({ httpUrl: "", fetch });
    const res = await client.call<{ pong: boolean }, { at: number }>("ping", { at: 1 });
    expectTypeOf(res).toEqualTypeOf<{ pong: boolean }>();
    expect(res).toEqual({ pong: true });
    const inferred = await client.call("ping", { at: 2 });
    expectTypeOf(inferred).toBeUnknown();
    expect(String(mock.mock.calls[1]?.[0])).toBe("/udc/ping");
  });

  it("keeps the built-in actions typed", async () => {
    const { fetch } = stubFetch(() => ({ row: { __meta: { id: "1", version: 1 } } }));
    const client = new UdcClient({ httpUrl: "", fetch });
    const read = await client.call("read", { collection: "c", id: "1" });
    expectTypeOf(read.row.__meta.id).toEqualTypeOf<string>();
    const never = () => {
      // @ts-expect-error read needs an id; a built-in name never falls through to the escape hatch
      void client.call("read", { collection: "c" });
      // @ts-expect-error not a field of the list request
      void client.call("list", { collection: "c", bogus: 1 });
    };
    expect(typeof never).toBe("function");
  });
});
