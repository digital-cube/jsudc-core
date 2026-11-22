import type { z } from "zod";
import { isActionName } from "./actions.js";

/**
 * An action a host adds to the protocol, defined once — its name and the Zod
 * schemas of its request and response — in a module the host's server and
 * its browser code both import. `@jsudc/server`'s `Dispatcher.register`
 * takes it (the handler is typed from it) and `UdcClient.call` takes it (the
 * payload and the result are typed from it).
 */
export interface HostAction<
  N extends string = string,
  Req extends z.ZodType = z.ZodType,
  Res extends z.ZodType = z.ZodType,
> {
  /** The action name: `POST /udc/<name>`, envelope kind `udc.<name>`. */
  readonly name: N;
  /** What the client sends; the server validates it (`validation_error` when it does not parse). */
  readonly request: Req;
  /** What the handler answers; the client parses it. */
  readonly response: Res;
}

/** What a client sends to a host action (the schema's input: defaults may be left out). */
export type HostActionPayload<A extends HostAction> = z.input<A["request"]>;
/** What the handler of a host action receives (the schema's output: defaults applied). */
export type HostActionRequest<A extends HostAction> = z.output<A["request"]>;
/** What the handler of a host action returns (the schema's input). */
export type HostActionReply<A extends HostAction> = z.input<A["response"]>;
/** What `UdcClient.call` resolves to for a host action (the schema's output). */
export type HostActionResponse<A extends HostAction> = z.output<A["response"]>;

/** A host action's name: dot-separated words of letters, digits, `_` and `-` (`mail.archive`). */
export const HOST_ACTION_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z][A-Za-z0-9_-]*)*$/;

/**
 * Define a host action once. Throws when the name is not a valid action
 * name or is one of the built-in actions (`ACTIONS`), which a host action
 * may not shadow.
 *
 * ```ts
 * export const archiveThread = defineHostAction({
 *   name: "mail.archive_thread",
 *   request: z.object({ thread_id: z.string() }),
 *   response: z.object({ archived: z.number().int() }),
 * });
 * ```
 */
export function defineHostAction<
  const N extends string,
  Req extends z.ZodType,
  Res extends z.ZodType,
>(def: { name: N; request: Req; response: Res }): HostAction<N, Req, Res> {
  if (!HOST_ACTION_NAME_RE.test(def.name)) {
    throw new Error(`defineHostAction: invalid action name ${JSON.stringify(def.name)}`);
  }
  if (isActionName(def.name)) {
    throw new Error(`defineHostAction: ${def.name} is a built-in action`);
  }
  return Object.freeze({ name: def.name, request: def.request, response: def.response });
}

/** Whether `value` is a `HostAction` (what `defineHostAction` returns, or an object of that shape). */
export function isHostAction(value: unknown): value is HostAction {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<HostAction>;
  return (
    typeof v.name === "string" &&
    typeof (v.request as { safeParse?: unknown } | undefined)?.safeParse === "function" &&
    typeof (v.response as { safeParse?: unknown } | undefined)?.safeParse === "function"
  );
}
