import { describe, expect, it } from "vitest";
import { codePaths, doc, failure, success } from "./compile.testing.js";

const withControl = (control: unknown) => doc({ control });

describe("VC-219 control", () => {
  it("defaults when the section is omitted (DFR-019)", () => {
    expect(success(doc()).control).toEqual({
      phases: ["main"],
      initialPhase: "main",
      turnOrder: ["seat1", "seat2", "seat3", "seat4"],
      initialActiveSeats: ["seat1"],
      pointerNames: [],
      enforceActiveSeats: false,
      outOfTurnKinds: [],
    });
    expect(success(withControl({})).control.phases).toEqual(["main"]);
  });

  it("defaults the active seat to the first seat of the given turn order", () => {
    const def = success(
      withControl({ turn_order: ["seat3", "seat1", "seat2", "seat4"] }),
    );
    expect(def.control.initialActiveSeats).toEqual(["seat3"]);
  });

  it("accepts an explicit initial_phase main without phases", () => {
    expect(
      success(withControl({ initial_phase: "main" })).control.initialPhase,
    ).toBe("main");
    expect(codePaths(failure(withControl({ initial_phase: "x" })))).toEqual([
      ["INVALID_VALUE", "control.initial_phase"],
    ]);
  });

  it.each([
    [
      "omitted seat",
      { turn_order: ["seat1", "seat2", "seat3"] },
      "INVALID_VALUE",
      "control.turn_order",
    ],
    [
      "repeated seat",
      { turn_order: ["seat1", "seat1", "seat2", "seat3", "seat4"] },
      "DUPLICATE_ID",
      "control.turn_order[1]",
    ],
    [
      "unknown seat",
      { turn_order: ["seat1", "seat2", "seat3", "nope"] },
      "UNKNOWN_REFERENCE",
      "control.turn_order[3]",
    ],
    [
      "phase outside phases",
      { phases: ["a"], initial_phase: "b" },
      "INVALID_VALUE",
      "control.initial_phase",
    ],
    [
      "phases without initial_phase",
      { phases: ["a"] },
      "SCHEMA_MISSING",
      "control.initial_phase",
    ],
    [
      "empty active seats",
      { initial_active_seats: [] },
      "INVALID_VALUE",
      "control.initial_active_seats",
    ],
    [
      "unknown active seat",
      { initial_active_seats: ["zz"] },
      "UNKNOWN_REFERENCE",
      "control.initial_active_seats[0]",
    ],
    [
      "duplicate active seat",
      { initial_active_seats: ["seat1", "seat1"] },
      "DUPLICATE_ID",
      "control.initial_active_seats[1]",
    ],
    [
      "duplicate pointers",
      { pointers: ["p", "p"] },
      "DUPLICATE_ID",
      "control.pointers[1]",
    ],
    [
      "duplicate phases",
      { phases: ["a", "a"], initial_phase: "a" },
      "DUPLICATE_ID",
      "control.phases[1]",
    ],
    [
      "empty phases",
      { phases: [], initial_phase: "a" },
      "INVALID_VALUE",
      "control.phases",
    ],
    [
      "non-boolean enforce",
      { enforce_active_seats: "yes" },
      "SCHEMA_TYPE",
      "control.enforce_active_seats",
    ],
  ])("rejects %s", (_n, control, code, path) => {
    expect(failure(withControl(control))[0]).toMatchObject({ code, path });
  });

  it("limits phases to 64 (LIMIT_EXCEEDED), accepting exactly 64", () => {
    const phases = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
    expect(
      success(withControl({ phases: phases(64), initial_phase: "p0" })).control
        .phases,
    ).toHaveLength(64);
    expect(
      codePaths(
        failure(withControl({ phases: phases(65), initial_phase: "p0" })),
      ),
    ).toEqual([["LIMIT_EXCEEDED", "control.phases"]]);
  });

  it("skips seat references when the seat layout failed", () => {
    expect(
      codePaths(
        failure(doc({ seats: { count: 0 }, control: { turn_order: ["x"] } })),
      ),
    ).toEqual([["INVALID_VALUE", "seats.count"]]);
  });
});
