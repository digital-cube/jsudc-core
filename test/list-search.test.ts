import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  CapabilitiesSchema,
  filter as f,
  ListRequestSchema,
  SEARCH_CAPABILITIES,
  SearchCapabilitySchema,
  sourceAnswersSearch,
} from "../src/index.js";

const caps = {
  mutate: true,
  subscribe: false,
  total_count: true,
  schema_edit: false,
  config_edit: false,
  reindex: false,
  tree_reparent: false,
  supported_filter_ops: ["eq", "contains"],
};

describe("ListRequest.search", () => {
  it("parses a request with search, alone and with filter, sort and page", () => {
    expect(ListRequestSchema.parse({ collection: "mail", search: "invoice" })).toEqual({
      collection: "mail",
      search: "invoice",
    });
    const full = {
      collection: "mail",
      search: '"quarterly report" -draft',
      filter: f.eq("folder", "inbox"),
      sort: [{ field: "received", dir: "desc" as const }],
      page: { limit: 20, offset: 40 },
    };
    expect(ListRequestSchema.parse(full)).toEqual(full);
    expect(ACTIONS.list.request.parse({ collection: "c", search: "x" }).search).toBe("x");
  });

  it("parses a request without search exactly as before", () => {
    const old = {
      collection: "books",
      filter: f.contains("title", "drin"),
      sort: [{ field: "year", dir: "asc" as const }],
      page: { limit: 50 },
    };
    const parsed = ListRequestSchema.parse(old);
    expect(parsed).toEqual(old);
    expect("search" in parsed).toBe(false);
    expect(ListRequestSchema.parse({ collection: "books" })).toEqual({ collection: "books" });
  });

  it("refuses a search that is not a string", () => {
    expect(ListRequestSchema.safeParse({ collection: "c", search: 3 }).success).toBe(false);
    expect(ListRequestSchema.safeParse({ collection: "c", search: ["a"] }).success).toBe(false);
  });
});

describe("capability search", () => {
  it("is optional: capabilities without it parse unchanged", () => {
    const parsed = CapabilitiesSchema.parse(caps);
    expect(parsed.search).toBeUndefined();
    expect(sourceAnswersSearch(parsed)).toBe(false);
  });

  it('accepts "source"', () => {
    const parsed = CapabilitiesSchema.parse({ ...caps, search: "source" });
    expect(parsed.search).toBe("source");
    expect(sourceAnswersSearch(parsed)).toBe(true);
  });

  it("refuses an unknown value", () => {
    expect(CapabilitiesSchema.safeParse({ ...caps, search: "client" }).success).toBe(false);
    expect(SearchCapabilitySchema.safeParse("hybrid").success).toBe(false);
    expect(SEARCH_CAPABILITIES).toEqual(["source"]);
  });

  it("sourceAnswersSearch tolerates missing capabilities", () => {
    expect(sourceAnswersSearch(undefined)).toBe(false);
    expect(sourceAnswersSearch(null)).toBe(false);
    expect(sourceAnswersSearch({})).toBe(false);
  });
});
