import { z } from "zod";

/**
 * The change feed: one long-lived `GET ${httpUrl}/udc/changes?collections=a,b`
 * answered as Server-Sent Events. Each `change` event says that rows of a
 * collection changed; it carries no row data, so the client refetches under
 * its own scope. A server announces the feed with `capabilities.changes`;
 * without it a client polls (`view.refresh_interval_ms`) as before.
 */
export const CHANGES_ROUTE = "/udc/changes";

/** The SSE `event:` name of a change. */
export const CHANGE_EVENT = "change";

/**
 * The SSE `event:` name the server sends once the stream is subscribed
 * (`data` is `{collections}`): anything written after it reaches the stream.
 */
export const CHANGES_READY_EVENT = "ready";

/** udc's vocabulary for what happened to the rows: the same three as `mutate`. */
export const CHANGE_OPS = ["insert", "update", "delete"] as const;
export const ChangeOpSchema = z.enum(CHANGE_OPS);
export type ChangeOp = z.infer<typeof ChangeOpSchema>;

/**
 * One change as the client receives it: which collection, what happened, and
 * the ids of the changed rows this subscriber may see. No `ids` means "this
 * collection changed" (a burst coalesced into one event, a renumbering, a
 * host that did not say which rows): refetch what is shown.
 */
export const ChangeEventSchema = z.object({
  collection: z.string().min(1),
  op: ChangeOpSchema,
  ids: z.array(z.string()).optional(),
});
export type ChangeEvent = z.infer<typeof ChangeEventSchema>;

/** The `data` of the `ready` event. */
export const ChangesReadySchema = z.object({ collections: z.array(z.string()) });
export type ChangesReady = z.infer<typeof ChangesReadySchema>;

/**
 * Whether the server pushes changes of the collection over the change feed
 * (`capabilities.changes === true`). Absent or `false`: poll as before.
 */
export function sourcePushesChanges(
  capabilities: { changes?: unknown } | null | undefined,
): boolean {
  return capabilities?.changes === true;
}

/** One Server-Sent Event as the parser hands it out. */
export interface SseMessage {
  /** `event:`; `"message"` when the event names none. */
  event: string;
  /** The `data:` lines joined with `\n`. */
  data: string;
  /** `id:`, when the event carries one. */
  id?: string;
  /** `retry:` in milliseconds, when the event carries one. */
  retry?: number;
}

/**
 * An incremental Server-Sent Events parser (the WHATWG event-stream format):
 * feed it the decoded text as it arrives, in chunks split anywhere, and it
 * returns the events completed so far. Comments (`:` lines, the heartbeat)
 * are skipped; a `retry:` alone is handed out as an event with empty data.
 */
export class SseParser {
  private buffer = "";
  private event = "";
  private data: string[] = [];
  private id: string | undefined;
  private retry: number | undefined;

  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const out: SseMessage[] = [];
    for (;;) {
      const match = /\r\n|\r|\n/.exec(this.buffer);
      if (!match) break;
      // A lone `\r` at the very end may be the first half of `\r\n`: wait for more.
      if (match[0] === "\r" && match.index === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const done = this.line(line);
      if (done) out.push(done);
    }
    return out;
  }

  private line(line: string): SseMessage | null {
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
    else if (field === "id" && !value.includes("\0")) this.id = value;
    else if (field === "retry" && /^\d+$/.test(value)) this.retry = Number(value);
    return null;
  }

  private dispatch(): SseMessage | null {
    const hasData = this.data.length > 0;
    const msg: SseMessage | null =
      hasData || this.retry !== undefined
        ? {
            event: this.event || "message",
            data: this.data.join("\n"),
            ...(this.id === undefined ? {} : { id: this.id }),
            ...(this.retry === undefined ? {} : { retry: this.retry }),
          }
        : null;
    this.event = "";
    this.data = [];
    this.retry = undefined;
    return msg;
  }
}
