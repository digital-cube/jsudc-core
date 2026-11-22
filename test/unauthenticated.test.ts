import { describe, expect, it } from "vitest";
import { UdcClient } from "../src/client.js";
import {
  ERROR_CODES,
  ErrorPayloadSchema,
  isUnauthenticated,
  UdcError,
  UNAUTHENTICATED_REASON,
  unauthenticatedError,
} from "../src/index.js";

describe("unauthenticatedError", () => {
  it("is forbidden with details.reason unauthenticated, no new error code", () => {
    const err = unauthenticatedError();
    expect(err).toBeInstanceOf(UdcError);
    expect(err.toPayload()).toEqual({
      code: "forbidden",
      message: "not signed in",
      details: { reason: "unauthenticated" },
    });
    expect(UNAUTHENTICATED_REASON).toBe("unauthenticated");
    expect(ERROR_CODES).not.toContain("unauthenticated");
    // A 0.3.x client parses it: the payload is valid for the closed schema.
    expect(ErrorPayloadSchema.safeParse(err.toPayload()).success).toBe(true);
  });

  it("keeps a custom message and extra details, the reason wins", () => {
    const err = unauthenticatedError("session expired", { reason: "x", login: "/login" });
    expect(err.message).toBe("session expired");
    expect(err.details).toEqual({ login: "/login", reason: "unauthenticated" });
  });
});

describe("isUnauthenticated", () => {
  it("recognises the error and its wire payload", () => {
    expect(isUnauthenticated(unauthenticatedError())).toBe(true);
    expect(isUnauthenticated(unauthenticatedError().toPayload())).toBe(true);
  });

  it("is false for anything else", () => {
    expect(isUnauthenticated(new UdcError("forbidden", "no"))).toBe(false);
    expect(isUnauthenticated(new UdcError("forbidden", "no", { reason: "other" }))).toBe(false);
    expect(isUnauthenticated(new UdcError("not_found", "x", { reason: "unauthenticated" }))).toBe(
      false,
    );
    expect(isUnauthenticated(new Error("forbidden"))).toBe(false);
    expect(isUnauthenticated(null)).toBe(false);
    expect(isUnauthenticated("forbidden")).toBe(false);
    expect(isUnauthenticated({ code: "forbidden", details: null })).toBe(false);
  });

  it("holds for the error the client throws on such a reply", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          kind: "udc.list.err",
          id: "1",
          payload: unauthenticatedError().toPayload(),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    const client = new UdcClient({ httpUrl: "http://x", fetch: fetchImpl });
    const err = await client.list({ collection: "c" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UdcError);
    expect(isUnauthenticated(err)).toBe(true);
  });
});
