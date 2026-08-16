/**
 * Folder hierarchy logic, kept free of storage and React.
 *
 * The rules here are the ones that quietly corrupt a tree when they are wrong:
 * a folder dragged into its own descendant, or a folder whose parent no longer
 * exists. Both are cheap to reason about as pure functions over a flat list and
 * expensive to debug once they have already been written to the database.
 */

import type { Folder, ID } from "../db/types";

export interface FolderNode {
  folder: Folder;
  children: FolderNode[];
  /** Nesting level, for indentation. Roots are 0. */
  depth: number;
}

/**
 * Builds the tree, sorted by name at each level.
 *
 * Folders whose parent is missing are surfaced as roots rather than dropped.
 * A folder that vanishes from the sidebar because of a dangling reference looks
 * exactly like data loss to the user, even though its notes are still there.
 */
export function buildFolderTree(folders: Folder[]): FolderNode[] {
  const byParent = new Map<ID | null, Folder[]>();
  const known = new Set(folders.map((f) => f.id));

  for (const folder of folders) {
    const parent =
      folder.parentFolderId && known.has(folder.parentFolderId)
        ? folder.parentFolderId
        : null;
    const siblings = byParent.get(parent) ?? [];
    siblings.push(folder);
    byParent.set(parent, siblings);
  }

  const build = (parentId: ID | null, depth: number): FolderNode[] =>
    (byParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((folder) => ({
        folder,
        depth,
        children: build(folder.id, depth + 1),
      }));

  return build(null, 0);
}

/** Every folder beneath `rootId`, excluding `rootId` itself. */
export function collectDescendantIds(folders: Folder[], rootId: ID): Set<ID> {
  const childrenOf = new Map<ID, ID[]>();
  for (const folder of folders) {
    if (!folder.parentFolderId) continue;
    const list = childrenOf.get(folder.parentFolderId) ?? [];
    list.push(folder.id);
    childrenOf.set(folder.parentFolderId, list);
  }

  const found = new Set<ID>();
  const queue = [...(childrenOf.get(rootId) ?? [])];

  while (queue.length > 0) {
    const id = queue.pop() as ID;
    // Guards against a pre-existing cycle in stored data; without it a corrupt
    // tree would hang the sidebar rather than merely look wrong.
    if (found.has(id)) continue;
    found.add(id);
    queue.push(...(childrenOf.get(id) ?? []));
  }

  return found;
}

/**
 * True when reparenting `folderId` under `newParentId` would detach a subtree
 * from the root — i.e. dropping a folder onto itself or one of its own
 * descendants.
 */
export function wouldCreateCycle(
  folders: Folder[],
  folderId: ID,
  newParentId: ID | null,
): boolean {
  if (newParentId === null) return false;
  if (newParentId === folderId) return true;
  return collectDescendantIds(folders, folderId).has(newParentId);
}

/** Root-to-folder chain, for breadcrumbs and "move to" labels. */
export function folderPath(folders: Folder[], folderId: ID): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: Folder[] = [];
  const seen = new Set<ID>();

  let current = byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentFolderId ? byId.get(current.parentFolderId) : undefined;
  }

  return path;
}

/** "Lore / Factions / Cults", for flat pickers. */
export function folderPathLabel(folders: Folder[], folderId: ID): string {
  return folderPath(folders, folderId)
    .map((f) => f.name)
    .join(" / ");
}

export interface MoveTarget {
  id: ID;
  label: string;
}

/** Every folder, path-labelled — the valid destinations for a note. */
export function allFolderTargets(folders: Folder[]): MoveTarget[] {
  return folders
    .map((f) => ({ id: f.id, label: folderPathLabel(folders, f.id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Valid destinations for moving `folderId`, flattened for a picker.
 *
 * Excludes the folder itself and everything under it, so an invalid move is not
 * offered in the first place rather than being rejected afterwards.
 */
export function validMoveTargets(folders: Folder[], folderId: ID): MoveTarget[] {
  const blocked = collectDescendantIds(folders, folderId);
  blocked.add(folderId);

  return allFolderTargets(folders).filter((target) => !blocked.has(target.id));
}
