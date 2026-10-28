export const WEB_VERSION = "0.3.0-local";
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
};
export type Card = {
  id: string;
  name: string;
  image: string;
  effect: string;
  type: string;
  condition?: string;
  status: Record<string, number>;
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
export type Game = {
  id: string;
  revision: number;
  status: string;
  round: number;
  phase: string;
  turn: number;
  activePlayerId: string;
  players: Player[];
  ark: Bag;
  seats: number;
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
};
export type Catalog = {
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
