import type { Disaster } from './disasters';
export type Dimension = "economy" | "society" | "environment";
export type Scope = "animals" | "humans" | "world";
export type Screen =
  | "role"
  | "rooms"
  | "lobby"
  | "game"
  | "report"
  | "records"
  | "detail"
  | "finished";
export type Role = { id: string; name: string; team: Scope; badge: string };
export type Seat = Role & { online?: boolean; ready?: boolean; teamLabel: string };
export type Change = {
  scope: Scope;
  dimension: Dimension;
  before: number;
  after: number;
  delta: number;
  scopeLabel?: string;
  label?: string;
};
export type Verdict = { title: string; statement: string; measures: string[]; tone: string };
export type TaskReport = {
  id: string;
  roleId: string;
  text: string;
  at: string;
  assessment: { completed: boolean; reason: string; used: boolean; fallbackReason: string | null };
};
export type Oracle = {
  id: string;
  round: number;
  status: string;
  god: { name: string };
  initialVerdict: Verdict;
  task?: {
    id: string;
    title: string;
    category: string;
    instruction: string;
    criteria: string;
    durationRounds: number;
  };
  finalVerdict?: Verdict;
  settlement?: object;
  taskReports: TaskReport[];
  playerRebuttal?: string;
  proposal?: { changes: Change[] };
  rag: { model: string; evidence: { id: string; title: string; content: string }[] };
  llm: { used: boolean; model: string; final?: { used: boolean } };
};
export type Room = {
  id: string;
  status: "lobby" | "playing" | "finished";
  round: number;
  revision: number;
  scoreRevision: number;
  createdAt: string;
  finishedAt: string | null;
  players: Record<string, { roleId: string; online: boolean; ready: boolean }>;
  scores: Record<Scope, Record<Dimension, number>>;
  judgments: Oracle[];
  activeDisasters: Disaster[];
  events: {
    id: string;
    type: string;
    detail: string;
    at: string;
    round: number;
    actor: string;
    changes: Change[];
  }[];
};
export type View = {
  roleId: string;
  roomId: string | null;
  room: Room | null;
  rooms: Room[];
  myRooms: Room[];
  pendingCreate: boolean;
  roles: Role[];
  role: Role | null;
  screen: Screen;
  busy: boolean;
  connected: boolean;
  error: string;
  oracle: Oracle | null;
  pending: boolean;
  readyCount: number;
  seats: Seat[];
  me: { online: boolean; ready: boolean } | null;
  report: TaskReport | null;
  changes: Change[];
  scoreGroups: {
    scope: Scope;
    label: string;
    dimensions: { key: Dimension; label: string; value: number; warning: boolean }[];
  }[];
  timeline: {
    id: string;
    time: string;
    round: number;
    detail: string;
    actorName: string;
    changesText: string;
  }[];
};
export const DIMENSIONS: { key: Dimension; label: string }[];
export const SCOPE_LABELS: Record<Scope, string>;
export function parseRoleCode(value: string): string;
export function parseRoomCode(value: string): string;
export function viewOf(state: unknown): View;
export type Client = {
  getState(): View;
  dispose(): void;
  init(): Promise<void>;
  refresh(): Promise<void>;
  openGame(): void;
  navigate(screen: Screen): void;
  selectRole(id: string): void;
  create(): Promise<Room | undefined>;
  join(id: string): Promise<Room | undefined>;
  detail(id: string): Promise<unknown>;
  act(type: string, input?: Record<string, unknown>): Promise<Room | undefined>;
};
export function createClient(options: {
  request: (path: string, method?: string, data?: unknown) => Promise<any>;
  storage: { get(key: string): any; set(key: string, value: unknown): void };
  storageKey?: string;
  initialRole?: string;
  onChange?: (state: View) => void;
  wait?: (ms: number) => Promise<void>;
}): Client;
