/**
 * Folder hierarchy rules.
 *
 * Two failure modes matter here, and both destroy data from the user's point of
 * view: a folder moved inside its own subtree disappears along with everything
 * under it, and a folder whose parent is missing vanishes from the sidebar. The
 * notes still exist in both cases, which makes it worse — nothing looks broken
 * except that the work is gone.
 */

import { describe, expect, it } from "vitest";
import {
  allFolderTargets,
  buildFolderTree,
  collectDescendantIds,
  folderPathLabel,
  validMoveTargets,
  wouldCreateCycle,
} from "@/lib/folders/tree";
import type { Folder } from "@/lib/db/types";

function folder(id: string, name: string, parentFolderId: string | null = null): Folder {
  return { id, campaignId: "c1", parentFolderId, name, createdAt: 0 };
}

/**
 *   Lore
 *     Factions
 *       Cults
 *   Sessions
 */
const TREE = [
  folder("lore", "Lore"),
  folder("factions", "Factions", "lore"),
  folder("cults", "Cults", "factions"),
  folder("sessions", "Sessions"),
];

describe("building the tree", () => {
  it("nests children under their parent", () => {
    const roots = buildFolderTree(TREE);

    expect(roots.map((n) => n.folder.name)).toEqual(["Lore", "Sessions"]);
    expect(roots[0].children[0].folder.name).toBe("Factions");
    expect(roots[0].children[0].children[0].folder.name).toBe("Cults");
  });

  it("records depth for indentation", () => {
    const roots = buildFolderTree(TREE);

    expect(roots[0].depth).toBe(0);
    expect(roots[0].children[0].depth).toBe(1);
    expect(roots[0].children[0].children[0].depth).toBe(2);
  });

  it("sorts siblings by name", () => {
    const roots = buildFolderTree([
      folder("b", "Beta"),
      folder("a", "Alpha"),
      folder("c", "Gamma"),
    ]);

    expect(roots.map((n) => n.folder.name)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("surfaces a folder whose parent is missing as a root", () => {
    // Otherwise the folder — and every note filed in it — silently disappears.
    const roots = buildFolderTree([folder("orphan", "Orphan", "deleted-parent")]);

    expect(roots.map((n) => n.folder.name)).toEqual(["Orphan"]);
  });

  it("handles an empty list", () => {
    expect(buildFolderTree([])).toEqual([]);
  });
});

describe("descendants", () => {
  it("collects the whole subtree", () => {
    expect([...collectDescendantIds(TREE, "lore")].sort()).toEqual(["cults", "factions"]);
  });

  it("excludes the root itself", () => {
    expect(collectDescendantIds(TREE, "lore").has("lore")).toBe(false);
  });

  it("returns nothing for a leaf", () => {
    expect(collectDescendantIds(TREE, "cults").size).toBe(0);
  });

  it("terminates on corrupt data that already contains a cycle", () => {
    // Two folders each claiming the other as parent. A naive walk never returns.
    const cyclic = [folder("a", "A", "b"), folder("b", "B", "a")];

    expect(collectDescendantIds(cyclic, "a").size).toBeLessThanOrEqual(2);
  });
});

describe("cycle prevention", () => {
  it("refuses moving a folder into itself", () => {
    expect(wouldCreateCycle(TREE, "lore", "lore")).toBe(true);
  });

  it("refuses moving a folder into its direct child", () => {
    expect(wouldCreateCycle(TREE, "lore", "factions")).toBe(true);
  });

  it("refuses moving a folder into a deeper descendant", () => {
    expect(wouldCreateCycle(TREE, "lore", "cults")).toBe(true);
  });

  it("allows moving into an unrelated folder", () => {
    expect(wouldCreateCycle(TREE, "lore", "sessions")).toBe(false);
  });

  it("allows moving a child up into a sibling branch", () => {
    expect(wouldCreateCycle(TREE, "cults", "sessions")).toBe(false);
  });

  it("always allows moving to the top level", () => {
    expect(wouldCreateCycle(TREE, "cults", null)).toBe(false);
  });
});

describe("path labels", () => {
  it("joins ancestors into a readable path", () => {
    expect(folderPathLabel(TREE, "cults")).toBe("Lore / Factions / Cults");
  });

  it("labels a root with just its name", () => {
    expect(folderPathLabel(TREE, "lore")).toBe("Lore");
  });

  it("does not loop on corrupt data", () => {
    const cyclic = [folder("a", "A", "b"), folder("b", "B", "a")];

    expect(folderPathLabel(cyclic, "a").length).toBeGreaterThan(0);
  });
});

describe("move targets", () => {
  it("offers every folder for a note", () => {
    expect(allFolderTargets(TREE).map((t) => t.id).sort()).toEqual([
      "cults",
      "factions",
      "lore",
      "sessions",
    ]);
  });

  it("hides the folder and its subtree when moving a folder", () => {
    const targets = validMoveTargets(TREE, "lore").map((t) => t.id);

    // Only destinations that would not detach the subtree.
    expect(targets).toEqual(["sessions"]);
  });

  it("offers ancestors when moving a leaf", () => {
    const targets = validMoveTargets(TREE, "cults").map((t) => t.id).sort();

    expect(targets).toEqual(["factions", "lore", "sessions"]);
  });

  it("labels targets with their full path", () => {
    const target = validMoveTargets(TREE, "sessions").find((t) => t.id === "cults");

    expect(target?.label).toBe("Lore / Factions / Cults");
  });
});
