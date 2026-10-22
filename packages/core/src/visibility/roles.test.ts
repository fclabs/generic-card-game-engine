import { describe, expect, it } from "vitest";
import { errorOf, must } from "../session/apply/apply.testing.js";
import { buildRoleRegistry, validateViewer } from "./roles.js";
import { buildRoleDefinition, roleState, seat } from "./visibility.testing.js";
import type { ViewerIdentity } from "./types.js";

const SPECTATOR = [{ id: "spectator", subject: "forbidden" as const }];
const state = roleState();
const codeOf = (
  registry: ReturnType<typeof buildRoleRegistry>,
  viewer: ViewerIdentity,
) => {
  const r = validateViewer(registry, state, viewer);
  return r.ok ? "ok" : r.error.code;
};

describe("VC-300 buildRoleRegistry", () => {
  const def = buildRoleDefinition({ roles: SPECTATOR });
  const registry = buildRoleRegistry(def);

  it("lists the built-ins and the declared roles with their subject rules", () => {
    expect(registry.roles).toEqual([
      { id: "player", subject: "required", builtIn: true },
      { id: "dealer", subject: "forbidden", builtIn: true },
      { id: "auditor", subject: "forbidden", builtIn: true },
      { id: "render", subject: "optional", builtIn: true },
      { id: "spectator", subject: "forbidden", builtIn: false },
    ]);
    expect(registry.registeredPrivileged).toEqual([]);
  });

  it("is deterministic", () => {
    expect(buildRoleRegistry(def)).toEqual(registry);
  });

  it("registers a privileged role only when a visibility entry is keyed by it", () => {
    const zoneOnly = buildRoleRegistry(
      buildRoleDefinition({ zoneVisibility: { dealer: "public" } }),
    );
    expect(zoneOnly.registeredPrivileged).toEqual(["dealer"]);
    const counter = buildRoleRegistry(
      buildRoleDefinition({ counterVisibility: { auditor: "hidden" } }),
    );
    expect(counter.registeredPrivileged).toEqual(["auditor"]);
    const both = buildRoleRegistry(
      buildRoleDefinition({
        zoneVisibility: { auditor: "public", dealer: "hidden" },
      }),
    );
    expect(both.registeredPrivileged).toEqual(["dealer", "auditor"]);
  });

  it("registers through a zone template", () => {
    const base = buildRoleDefinition();
    const withTemplate = buildRoleDefinition({
      zoneTemplates: base.zoneTemplates.map((t) => ({
        ...t,
        visibility: { auditor: "public" },
      })),
    });
    expect(buildRoleRegistry(withTemplate).registeredPrivileged).toEqual([
      "auditor",
    ]);
  });

  it("is frozen: nothing can be registered afterwards", () => {
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.roles)).toBe(true);
    expect(Object.isFrozen(registry.roles[0])).toBe(true);
    expect(Object.isFrozen(registry.registeredPrivileged)).toBe(true);
    expect(() => {
      (registry.roles as unknown[]).push({ id: "x" });
    }).toThrow(TypeError);
  });
});

describe("VC-301 validateViewer errors", () => {
  const plain = buildRoleRegistry(buildRoleDefinition({ roles: SPECTATOR }));
  const dealerRegistered = buildRoleRegistry(
    buildRoleDefinition({ zoneVisibility: { dealer: "public" } }),
  );

  it("unknown role, including the empty string", () => {
    expect(codeOf(plain, { role: "wizard" })).toBe("UNKNOWN_ROLE");
    expect(codeOf(plain, { role: "" })).toBe("UNKNOWN_ROLE");
  });

  it("a subject for a forbidden-subject role", () => {
    expect(
      codeOf(dealerRegistered, { role: "dealer", subject: seat("north") }),
    ).toBe("SUBJECT_NOT_ALLOWED");
    expect(codeOf(plain, { role: "spectator", subject: seat("north") })).toBe(
      "SUBJECT_NOT_ALLOWED",
    );
  });

  it("a missing or undeclared subject for player", () => {
    expect(codeOf(plain, { role: "player" })).toBe("UNKNOWN_SUBJECT");
    expect(codeOf(plain, { role: "player", subject: seat("ghost") })).toBe(
      "UNKNOWN_SUBJECT",
    );
    expect(codeOf(plain, { role: "player", subject: seat("north") })).toBe(
      "ok",
    );
  });

  it("render accepts a valid subject or none, but not an undeclared one", () => {
    expect(codeOf(plain, { role: "render" })).toBe("ok");
    expect(codeOf(plain, { role: "render", subject: seat("east") })).toBe("ok");
    expect(codeOf(plain, { role: "render", subject: seat("ghost") })).toBe(
      "UNKNOWN_SUBJECT",
    );
  });

  it("a custom spectator without a subject is ok", () => {
    expect(codeOf(plain, { role: "spectator" })).toBe("ok");
  });

  it("returns the viewer on success", () => {
    const viewer = { role: "player", subject: seat("south") };
    expect(must(validateViewer(plain, state, viewer))).toEqual(viewer);
  });
});

describe("VC-302 privileged denial", () => {
  it("dealer and auditor are VIEW_DENIED without keyed rules", () => {
    const registry = buildRoleRegistry(buildRoleDefinition());
    expect(codeOf(registry, { role: "dealer" })).toBe("VIEW_DENIED");
    expect(codeOf(registry, { role: "auditor" })).toBe("VIEW_DENIED");
  });

  it("registering dealer admits only dealer", () => {
    const registry = buildRoleRegistry(
      buildRoleDefinition({ zoneVisibility: { dealer: "public" } }),
    );
    expect(codeOf(registry, { role: "dealer" })).toBe("ok");
    expect(codeOf(registry, { role: "auditor" })).toBe("VIEW_DENIED");
  });

  it("a default-only definition leaves both denied", () => {
    const registry = buildRoleRegistry(
      buildRoleDefinition({
        zoneVisibility: { default: "public" },
        counterVisibility: { default: "public" },
      }),
    );
    expect(registry.registeredPrivileged).toEqual([]);
    expect(codeOf(registry, { role: "dealer" })).toBe("VIEW_DENIED");
    expect(codeOf(registry, { role: "auditor" })).toBe("VIEW_DENIED");
  });
});

describe("VC-303 check order", () => {
  const registry = buildRoleRegistry(buildRoleDefinition());

  it("role is checked before subject", () => {
    expect(
      codeOf(registry, { role: "ghost", subject: seat("ghost-seat") }),
    ).toBe("UNKNOWN_ROLE");
  });

  it("subject rule is checked before registration", () => {
    expect(codeOf(registry, { role: "dealer", subject: seat("north") })).toBe(
      "SUBJECT_NOT_ALLOWED",
    );
  });

  it("subject seat is checked before registration", () => {
    expect(codeOf(registry, { role: "render", subject: seat("ghost") })).toBe(
      "UNKNOWN_SUBJECT",
    );
  });
});

describe("PBR-008 error detail names only supplied ids", () => {
  const registry = buildRoleRegistry(buildRoleDefinition());
  it("mentions the supplied role and subject and no other seat", () => {
    const e = errorOf(
      validateViewer(registry, state, {
        role: "player",
        subject: seat("ghost"),
      }),
    );
    expect(e.detail).toContain('"ghost"');
    for (const other of ["north", "east", "south", "west", "ns", "pn"]) {
      expect(e.detail).not.toContain(other);
    }
    const d = errorOf(validateViewer(registry, state, { role: "dealer" }));
    expect(d.detail).toContain('"dealer"');
  });
});

describe("VC-305 spectator recipe, registry half", () => {
  const registry = buildRoleRegistry(
    buildRoleDefinition({
      roles: SPECTATOR,
      zoneVisibility: { spectator: "public" },
    }),
  );
  it("spectator without subject is ok, with a subject SUBJECT_NOT_ALLOWED", () => {
    expect(codeOf(registry, { role: "spectator" })).toBe("ok");
    expect(
      codeOf(registry, { role: "spectator", subject: seat("north") }),
    ).toBe("SUBJECT_NOT_ALLOWED");
  });
  it("render takes an optional subject", () => {
    expect(codeOf(registry, { role: "render" })).toBe("ok");
    expect(codeOf(registry, { role: "render", subject: seat("north") })).toBe(
      "ok",
    );
  });
});
