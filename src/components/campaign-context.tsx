"use client";

/**
 * Campaign-wide state: the entity vocabulary and the compiled recogniser.
 *
 * Entities change rarely, but every keystroke in every open note needs to match
 * against them. Compiling the automaton once here — and handing the editor a
 * stable holder rather than a new object — is what keeps recognition off the
 * typing hot path (PRD §63).
 */

import { useLiveQuery } from "dexie-react-hooks";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { db, ensureCampaign } from "@/lib/db/db";
import { reindexCampaign } from "@/lib/db/repositories";
import type { Campaign, Entity, EntityAlias, EntityType } from "@/lib/db/types";
import { EntityRecognizer } from "@/lib/entities/recognizer";
import type { EntityDisplayInfo } from "@/lib/editor/entity-highlight";

interface CampaignValue {
  campaign: Campaign | null;
  entities: Entity[];
  aliases: EntityAlias[];
  entityTypes: EntityType[];
  entityById: Map<string, Entity>;
  typeById: Map<string, EntityType>;
  /**
   * The current recogniser. Its identity changes exactly when the vocabulary
   * does, so components can depend on it to know when to repaint.
   */
  recognizer: EntityRecognizer;
  /** Display metadata for a recognised entity, for decorations and popovers. */
  lookup: (entityId: string) => EntityDisplayInfo | undefined;
  ready: boolean;
}

const CampaignContext = createContext<CampaignValue | null>(null);

const FALLBACK_ICON = "◇";
const FALLBACK_THEME_KEY = "concept";

/** Collapses a burst of vocabulary edits into a single re-index pass. */
const REINDEX_DEBOUNCE_MS = 400;

export function CampaignProvider({ children }: { children: ReactNode }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureCampaign().then((c) => {
      if (!cancelled) setCampaign(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const campaignId = campaign?.id;

  const entities = useLiveQuery(
    () =>
      campaignId
        ? db.entities.where("campaignId").equals(campaignId).toArray()
        : Promise.resolve<Entity[]>([]),
    [campaignId],
    [] as Entity[],
  );

  const entityTypes = useLiveQuery(
    () =>
      campaignId
        ? db.entityTypes.where("campaignId").equals(campaignId).sortBy("sortOrder")
        : Promise.resolve<EntityType[]>([]),
    [campaignId],
    [] as EntityType[],
  );

  /**
   * Aliases are fetched for the campaign's entities rather than wholesale,
   * since the table is not campaign-scoped — an alias belongs to an entity,
   * and the entity carries the campaign.
   */
  const aliases = useLiveQuery(async () => {
    if (!campaignId) return [] as EntityAlias[];
    const ids = await db.entities.where("campaignId").equals(campaignId).primaryKeys();
    if (ids.length === 0) return [] as EntityAlias[];
    return db.entityAliases.where("entityId").anyOf(ids).toArray();
  }, [campaignId, entities], [] as EntityAlias[]);

  const entityById = useMemo(
    () => new Map(entities.map((e) => [e.id, e])),
    [entities],
  );
  const typeById = useMemo(
    () => new Map(entityTypes.map((t) => [t.id, t])),
    [entityTypes],
  );

  const recognizer = useMemo(
    () => EntityRecognizer.fromCampaign(entities, aliases),
    [entities, aliases],
  );

  const lookup = useCallback(
    (entityId: string) => {
      const entity = entityById.get(entityId);
      if (!entity) return undefined;
      const type = typeById.get(entity.entityTypeId);
      return {
        name: entity.name,
        themeKey: type?.themeKey ?? FALLBACK_THEME_KEY,
        icon: type?.icon ?? FALLBACK_ICON,
      };
    },
    [entityById, typeById],
  );

  /**
   * Re-index every note against the vocabulary whenever it changes.
   *
   * Without this, mentions would only be computed for the note being edited,
   * and flagging a name would fail to backlink the sessions already written
   * about it — the single most likely way a GM would use the feature.
   *
   * Debounced so a burst of edits — creating an entity, then adding two
   * aliases — costs one pass. The open note re-saves on its own debounce, so a
   * scan that races a keystroke is corrected moments later.
   */
  useEffect(() => {
    if (!campaignId) return;

    const timer = setTimeout(() => {
      void reindexCampaign(campaignId, recognizer);
    }, REINDEX_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [campaignId, recognizer]);

  const value = useMemo<CampaignValue>(
    () => ({
      campaign,
      entities,
      aliases,
      entityTypes,
      entityById,
      typeById,
      recognizer,
      lookup,
      ready: Boolean(campaign) && entityTypes.length > 0,
    }),
    [
      campaign,
      entities,
      aliases,
      entityTypes,
      entityById,
      typeById,
      recognizer,
      lookup,
    ],
  );

  return (
    <CampaignContext.Provider value={value}>{children}</CampaignContext.Provider>
  );
}

export function useCampaign(): CampaignValue {
  const value = useContext(CampaignContext);
  if (!value) throw new Error("useCampaign must be used inside CampaignProvider");
  return value;
}
