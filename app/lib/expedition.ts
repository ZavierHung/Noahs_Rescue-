export const WEB_VERSION = "0.4.0-local";
export type Resource = "wood" | "metal" | "electricity" | "seed";
export type Bag = Record<Resource, number>;
export type WorldAttributes = Record<
  "economy" | "environment" | "society",
  number
>;
export type Character = {
  id: string;
  name: string;
  image: string;
  factionLabel: string;
  implementedEffect?: string;
  effectSummary?: string;
};
export type Card = {
  id: string;
  name: string;
  image: string;
  effect: string;
  type: string;
  condition?: string;
  status: Record<string, number>;
  implementedEffect?: string;
  effectSummary?: string;
  learningEffect?: string;
  learningSummary?: string;
  learningStatus?: Record<string, number>;
  learningImage?: string;
};
export type Tile = {
  id: string;
  q: number;
  r: number;
  x: number;
  y: number;
  zone: number;
  terrain: string;
  resource: Resource | null;
  flag?: string;
};
export type Player = {
  survivalPreview: {
    alive: boolean;
    safe: boolean;
    injury: number;
    seedsUsed: number;
    remainingInjury: number;
    tolerance: number;
    reason: string;
  };
  floodInjury: number;
  id: string;
  name: string;
  characterId: string;
  position: string;
  spawn: string;
  resources: Bag;
  worldImpact: WorldAttributes;
  handLimit: number;
  hand: { uid: string; id: string }[];
  equipment: string[];
  donated: Bag;
};
export type Event = {
  seq: number;
  round: number;
  actor: string;
  type: string;
  detail: string;
  effects?: { playerId: string; resources: Bag; from: string; to: string }[];
  [key: string]: unknown;
};
export type HistoryAction = {
  id: string;
  actor: string;
  type: string;
  label: string;
  round: number;
  phase: string;
  revision: number;
};
export type HistoryAudit = {
  seq: number;
  type: "undo" | "redo" | "branch";
  actor: string;
  round: number;
  revision: number;
  at: string;
  detail: string;
  events?: Event[];
};
export type Game = {
  learningMode?: boolean;
  learning?: Record<string, unknown>;
  peerReviewSummary?: {
    enabled: boolean;
    complete: boolean;
    remaining: string[];
    activeReviewerId: string | null;
    submissions: {
      reviewerId: string;
      waived: boolean;
      entries: PeerReviewEntry[];
      revision: number;
    }[];
  };
  learningOutcome?: LearningOutcome | null;
  id: string;
  revision: number;
  history: {
    limit: number;
    actorId: string;
    lockedReason: string;
    undoCount: number;
    redoCount: number;
    undo: HistoryAction | null;
    redo: HistoryAction | null;
    lastChangeRevision: number;
  };
  historyAudit: HistoryAudit[];
  status: string;
  round: number;
  phase: string;
  turn: number;
  activePlayerId: string;
  players: Player[];
  ark: Bag;
  seats: number;
  capacity: {
    units: number;
    unitsPerSeat: number;
    maxSeats: number;
    seats: number;
    nextSeatNeeds: number;
  };
  rules: {
    finalEvacuationSteps: number;
    floodInjuryTolerance: number;
    seedRecovery: number;
    arkUnitsPerSeat: number;
  };
  reviewRemaining?: string[];
  invitation: {
    targets: {
      playerId: string;
      distance: number;
      rank: number;
      eligible: boolean;
    }[];
    blockedReason: string;
    responseReason: string;
  };
  floodLevel: number;
  reachable: Record<string, string[]>;
  events: Event[];
  donations: { round: number; playerId: string; amounts: Bag }[];
  pending: any;
  judgment: any;
  activeDisasters: import("./disasters").Disaster[];
  attributes: WorldAttributes;
  world: {
    base: WorldAttributes;
    modifiers: WorldAttributes;
    harvested: Record<string, number>;
  };
  canGather: boolean;
  trade: {
    targets: { playerId: string; distance: number; contact: boolean }[];
    invitationBlockedReason: string;
    beaconBlockedReason: string;
    response: { reason: string } | null;
  };
};
export type PeerReviewEntry = {
  targetId: string;
  rating: number | null;
  comment: string;
  evidence: number[];
};
export type LearningOutcome = {
  version: string;
  tier: string;
  title: string;
  goals: {
    id: string;
    title: string;
    achieved: boolean | null;
    detail: string;
  }[];
  collective: { survivors: number; total: number; survivalRate: number };
  ark: {
    seats: number;
    units: number;
    unitsPerSeat: number;
    canAccommodateSurvivors: boolean;
  };
  ecology: {
    environment: number;
    playerNetChange: number;
    repairActions: number;
    damageActions: number;
    manualAdjustments: number;
  };
  personal: {
    playerId: string;
    survived: boolean;
    boarded: boolean | null;
    donatedUnits: number;
    cooperationCount: number;
    repairActions: number;
    repairedAfterHarm: boolean;
    peerReviewSubmitted: boolean;
    peerReviewWaived: boolean;
    discussionSubmitted: boolean;
  }[];
  boarding: {
    final: boolean;
    decided: boolean;
    boardedIds: string[];
    source: string;
  };
  disclaimer: string;
};
export type Catalog = {
  floodCard: {
    name: string;
    image: string;
    implementedEffect: string;
    effectSummary: string;
  };
  characters: Character[];
  cards: { actions: Card[]; technology: Card[] };
  resources: Record<Resource, string>;
  map: {
    image: string;
    radius: number;
    tiles: Tile[];
    flags: { id: string; tileId: string; x: number; y: number }[];
  };
};
const BASE = process.env.NEXT_PUBLIC_GAME_API_URL || "http://localhost:8787";
export const academicOriginalUrl = (id: string) =>
  `${BASE}/api/expeditions/knowledge/original/${encodeURIComponent(id)}`;
export async function apiRequest<T>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const response = await fetch(`${BASE}/api/expeditions${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "服务暂不可用");
  return body;
}
