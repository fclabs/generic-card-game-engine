import { describe, expect, it } from "vitest";
import { playerId } from "../session/ids.js";
import { must } from "../session/apply/apply.testing.js";
import {
  buildVisibilityPolicy,
  isEntitled,
  resolveAudience,
} from "./policy.js";
import {
  buildRoleDefinition,
  roleState,
  seat,
  zone,
} from "./visibility.testing.js";
import type { ViewerIdentity } from "./types.js";

const state = roleState();
const player = (s: string): ViewerIdentity => ({
  role: "player",
  subject: seat(s),
});

describe("VC-306 default applies to non-privileged roles only", () => {
  it("default public resolves for player, render and custom roles, not dealer/auditor", () => {
    const rules = { default: "public" } as const;
    for (const role of ["player", "render", "spectator"]) {
      expect(resolveAudience(rules, role)).toBe("public");
    }
    expect(resolveAudience(rules, "dealer")).toBeUndefined();
    expect(resolveAudience(rules, "auditor")).toBeUndefined();
  });

  it("a keyed entry wins over default, including for privileged roles", () => {
    const rules = {
      default: "hidden",
      player: "owner",
      dealer: "public",
    } as const;
    expect(resolveAudience(rules, "player")).toBe("owner");
    expect(resolveAudience(rules, "render")).toBe("hidden");
    expect(resolveAudience(rules, "dealer")).toBe("public");
    expect(resolveAudience(rules, "auditor")).toBeUndefined();
  });

  it("the policy looks up zones, templates and counters per role", () => {
    const base = buildRoleDefinition();
    const def = buildRoleDefinition({
      zoneVisibility: { default: "hidden", player: "owner" },
      counterVisibility: { default: "public" },
      zoneTemplates: base.zoneTemplates.map((t) => ({
        ...t,
        visibility: { default: "team" },
      })),
    });
    const policy = buildVisibilityPolicy(def);
    expect(policy.zoneAudience(zone("deck"), undefined, "player")).toBe(
      "owner",
    );
    expect(policy.zoneAudience(zone("deck"), undefined, "render")).toBe(
      "hidden",
    );
    expect(
      policy.zoneAudience(zone("deck"), undefined, "dealer"),
    ).toBeUndefined();
    expect(policy.zoneAudience(zone("hand/north"), "hand", "player")).toBe(
      "team",
    );
    expect(
      policy.zoneAudience(zone("hand/north"), "hand", "auditor"),
    ).toBeUndefined();
    const counter = def.counters[0];
    if (counter === undefined) throw new Error("fixture");
    expect(policy.counterAudience(counter.id, "render")).toBe("public");
    expect(policy.counterAudience(counter.id, "dealer")).toBeUndefined();
  });

  it("owner audience entitles only the owner seat", () => {
    const audience = resolveAudience(
      { default: "hidden", player: "owner" },
      "player",
    );
    expect(isEntitled(audience, "north", player("north"), state)).toBe(true);
    expect(isEntitled(audience, "north", player("east"), state)).toBe(false);
  });
});

describe("VC-307 owner and team resolution", () => {
  it("owner on a seat-owned zone", () => {
    expect(isEntitled("owner", "north", player("north"), state)).toBe(true);
    expect(isEntitled("owner", "north", player("east"), state)).toBe(false);
    expect(
      isEntitled(
        "owner",
        "north",
        { role: "render", subject: seat("north") },
        state,
      ),
    ).toBe(true);
    expect(isEntitled("owner", "north", { role: "render" }, state)).toBe(false);
  });

  it("owner on a team-owned zone", () => {
    expect(isEntitled("owner", "ns", player("north"), state)).toBe(true);
    expect(isEntitled("owner", "ns", player("south"), state)).toBe(true);
    expect(isEntitled("owner", "ns", player("east"), state)).toBe(false);
  });

  it("owner on a player-owned zone: the player seated at the viewer's seat", () => {
    expect(isEntitled("owner", "pn", player("north"), state)).toBe(true);
    expect(isEntitled("owner", "pn", player("south"), state)).toBe(false);
    expect(
      isEntitled(
        "owner",
        String(must(playerId("nobody"))),
        player("north"),
        state,
      ),
    ).toBe(false);
  });

  it("team audience on a seat-owned zone: the owner's teammates", () => {
    expect(isEntitled("team", "north", player("south"), state)).toBe(true);
    expect(isEntitled("team", "north", player("north"), state)).toBe(true);
    expect(isEntitled("team", "north", player("east"), state)).toBe(false);
  });

  it("team audience on team- and player-owned zones", () => {
    expect(isEntitled("team", "ns", player("south"), state)).toBe(true);
    expect(isEntitled("team", "ns", player("west"), state)).toBe(false);
    expect(isEntitled("team", "pw", player("east"), state)).toBe(true);
    expect(isEntitled("team", "pw", player("north"), state)).toBe(false);
  });

  it("owner and team never entitle a subject-less viewer or an unowned entity", () => {
    expect(isEntitled("owner", "north", { role: "render" }, state)).toBe(false);
    expect(isEntitled("team", "north", { role: "render" }, state)).toBe(false);
    expect(isEntitled("owner", undefined, player("north"), state)).toBe(false);
    expect(isEntitled("team", undefined, player("north"), state)).toBe(false);
  });

  it("a seat without a team has no teammates", () => {
    const s = roleState(buildRoleDefinition());
    const teamless = {
      ...s,
      roster: {
        seats: { ...s.roster.seats, north: { status: "seated" as const } },
      },
    };
    expect(isEntitled("team", "north", player("north"), teamless)).toBe(false);
    expect(isEntitled("owner", "north", player("north"), teamless)).toBe(true);
  });

  it("public entitles everyone, hidden no one", () => {
    expect(isEntitled("public", undefined, { role: "render" }, state)).toBe(
      true,
    );
    expect(isEntitled("hidden", "north", player("north"), state)).toBe(false);
  });
});

describe("VC-308 absent declaration hides", () => {
  const def = buildRoleDefinition({
    zoneVisibility: { player: "public" },
    counterVisibility: {},
  });
  const policy = buildVisibilityPolicy(def);
  const counter = def.counters[0];
  if (counter === undefined) throw new Error("fixture");

  it("an empty visibility, an unknown entity and a missing role entry give undefined", () => {
    expect(resolveAudience({}, "player")).toBeUndefined();
    expect(policy.counterAudience(counter.id, "player")).toBeUndefined();
    expect(
      policy.zoneAudience(zone("nope"), undefined, "player"),
    ).toBeUndefined();
    expect(
      policy.zoneAudience(zone("deck"), undefined, "render"),
    ).toBeUndefined();
  });

  it("undefined is never entitled, for any viewer", () => {
    const viewers: ViewerIdentity[] = [
      player("north"),
      { role: "render", subject: seat("north") },
      { role: "render" },
      { role: "auditor" },
      { role: "dealer" },
    ];
    for (const viewer of viewers) {
      expect(isEntitled(undefined, "north", viewer, state)).toBe(false);
      expect(isEntitled(undefined, undefined, viewer, state)).toBe(false);
    }
  });
});

describe("field visibility accessors", () => {
  it("expose declared card and meta field visibility only", () => {
    const base = buildRoleDefinition();
    const card = base.cards[0];
    const schema = base.metaSchemas[0];
    if (card === undefined || schema === undefined) throw new Error("fixture");
    const def = buildRoleDefinition({
      cards: [
        { ...card, metadataVisibility: { rank: "public", suit: "secret" } },
      ],
      metaSchemas: [{ ...schema, fieldVisibility: { text: "subject" } }],
    });
    const policy = buildVisibilityPolicy(def);
    expect(policy.cardFieldVisibility(card.id, "rank")).toBe("public");
    expect(policy.cardFieldVisibility(card.id, "suit")).toBe("secret");
    expect(policy.cardFieldVisibility(card.id, "other")).toBeUndefined();
    expect(policy.metaFieldVisibility(schema.id, "text")).toBe("subject");
    expect(policy.metaFieldVisibility("nope", "text")).toBeUndefined();
  });
});
