import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  AbortSignalLike,
  Accept,
  Action,
  Allow,
  AuthorizationHook,
  Deny,
  Effect,
  GateMaskedSnapshot,
  GateResolveHook,
  Macro,
  Proposal,
  ReactionHook,
  Reducer,
  Reject,
  SealedBySeat,
  ValidationHook,
} from "./index.js";
import type {
  Action as SessionAction,
  GateMaskedSnapshot as SessionMasked,
  Macro as SessionMacro,
  Reducer as SessionReducer,
  SealedBySeat as SessionSealed,
  SeatId,
  SessionId,
  Snapshot,
} from "../session/index.js";
import * as spi from "./index.js";

const seat = "s1" as SeatId;
const signal: AbortSignalLike = new AbortController().signal;

describe("VC-080 SPI types accept the architecture A4 shapes", () => {
  it("Reducer<S> is synchronous and returns S", () => {
    expectTypeOf<Reducer<{ n: number }>>().toEqualTypeOf<
      (partition: Snapshot<{ n: number }>, payload: unknown) => { n: number }
    >();
    expectTypeOf<ReturnType<Reducer<{ n: number }>>>().toEqualTypeOf<{
      n: number;
    }>();
    expectTypeOf<ReturnType<Reducer<{ n: number }>>>().not.toEqualTypeOf<
      Promise<{ n: number }>
    >();
    const bad: Reducer<{ n: number }> = (p) => p;
    // @ts-expect-error a reducer cannot be asynchronous
    const asyncReducer: Reducer<{ n: number }> = (p) => Promise.resolve(p);
    expect(typeof bad).toBe("function");
    expect(typeof asyncReducer).toBe("function");
  });

  it("re-exports session types, not copies", () => {
    expectTypeOf<Reducer<number>>().toEqualTypeOf<SessionReducer<number>>();
    expectTypeOf<Action>().toEqualTypeOf<SessionAction>();
    expectTypeOf<Macro>().toEqualTypeOf<SessionMacro>();
    expectTypeOf<GateMaskedSnapshot>().toEqualTypeOf<SessionMasked>();
    expectTypeOf<SealedBySeat>().toEqualTypeOf<SessionSealed>();
  });

  it("hooks are async and take the A4 contexts", () => {
    const validate: ValidationHook<"play"> = (ctx) => {
      expectTypeOf(ctx.proposal).toEqualTypeOf<Proposal<"play">>();
      expectTypeOf(ctx.snapshot).toEqualTypeOf<GateMaskedSnapshot>();
      expectTypeOf(ctx.signal).toEqualTypeOf<AbortSignalLike>();
      expectTypeOf(ctx.actor.actingSeat).toEqualTypeOf<SeatId>();
      return Promise.resolve<Accept | Reject>({ accepted: true });
    };
    expectTypeOf(validate).returns.toEqualTypeOf<Promise<Accept | Reject>>();
    const react: ReactionHook = () =>
      Promise.resolve({
        actions: [{ kind: "lifecycle", to_state: "completed" }],
        effects: [
          {
            type: "timer_request",
            id: "t1",
            kind: "turn",
            duration_hint: 30000,
          },
        ],
      });
    const resolve: GateResolveHook = (ctx) => {
      expectTypeOf(ctx.sealed).toEqualTypeOf<SealedBySeat>();
      expectTypeOf(ctx.missing).toEqualTypeOf<readonly SeatId[]>();
      return Promise.resolve([]);
    };
    const authorize: AuthorizationHook = () =>
      Promise.resolve({ allowed: true });
    expect([validate, react, resolve, authorize]).toHaveLength(4);
    // @ts-expect-error a validation hook cannot be synchronous
    const syncHook: ValidationHook = () => ({ accepted: true });
    expect(syncHook).toBeTypeOf("function");
  });

  it("verdicts and effects have the expected shapes", () => {
    const accept: Accept = { accepted: true };
    const reject: Reject = {
      accepted: false,
      rejection: { code: "NOT_ALLOWED" },
    };
    const allow: Allow = { allowed: true };
    const deny: Deny = { allowed: false, code: "FORBIDDEN" };
    const effect: Effect = {
      type: "timer_request",
      id: "t",
      kind: "k",
      duration_hint: 1,
    };
    // @ts-expect-error timer_request needs duration_hint
    const missing: Effect = { type: "timer_request", id: "t", kind: "k" };
    expect([accept, reject, allow, deny, effect, missing]).toHaveLength(6);
    const sealed: SealedBySeat = [seat];
    expect(sealed).toEqual([seat]);
    expectTypeOf<SessionId>().not.toEqualTypeOf<string>();
  });
});

describe("VC-095 host AbortSignal is assignable to AbortSignalLike", () => {
  it("works with the Node/DOM AbortSignal", () => {
    expectTypeOf<AbortSignal>().toMatchTypeOf<AbortSignalLike>();
    const ctl = new AbortController();
    const like: AbortSignalLike = ctl.signal;
    let fired = 0;
    const listener = (): void => {
      fired += 1;
    };
    like.addEventListener("abort", listener);
    ctl.abort();
    like.removeEventListener("abort", listener);
    expect(like.aborted).toBe(true);
    expect(fired).toBe(1);
    expect(signal.aborted).toBe(false);
  });
});

describe("VC-081 runtime surface of spi", () => {
  it("exports no runtime value", () => {
    expect(Object.keys(spi)).toEqual([]);
  });
});
