import type { Disaster } from './disasters';
export type { Disaster } from './disasters';

const API_BASE = process.env.NEXT_PUBLIC_GAME_API_URL || 'http://localhost:8787';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json');
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || '本地 API 请求失败。');
  return payload;
}

export const api = {
  health: () => request<{ ok: boolean; rag: { model: string; documents: number }; llm: { provider: string; protocol: string; model: string; enabled: boolean } }>('/api/health'),
  state: () => request<WorldState>('/api/state'),
  saveState: (attributes: Attributes) => request<WorldState>('/api/state', { method: 'PUT', body: JSON.stringify({ attributes }) }),
  judgments: () => request<Judgment[]>('/api/judgments'),
  startJudgment: () => request<Judgment>('/api/judgments', { method: 'POST', body: JSON.stringify({ player: { id: 'player-1', name: '玩家一' } }) }),
  rebut: (id: string, text: string) => request<Judgment>(`/api/judgments/${id}/rebuttal`, { method: 'POST', body: JSON.stringify({ text }) }),
};

export type Attributes = { economy: number; environment: number; society: number };
export type WorldState = { round: number; attributes: Attributes; activeDisasters: Disaster[]; updatedAt: string | null };
export type Evidence = { id: string; title: string; content: string; score: number };
export type Judgment = {
  id: string;
  status: 'awaiting_rebuttal' | 'final';
  createdAt: string;
  god: { id: string; name: string; type: string; values: string; voice: string };
  rag: { model: string; evidence: Evidence[] };
  llm: { provider: string; model: string | null; configured: boolean; used: boolean; fallbackReason: string | null; final?: { used: boolean } };
  initialVerdict: { classification: string; tone: string; title: string; statement: string; measures: string[] };
  rebuttal: null | { text: string; submittedAt: string; recognizedRemedy: boolean };
  finalVerdict: null | { title: string; tone: string; statement: string; measures: string[]; unavoidable: boolean };
  stateSnapshot: WorldState;
};
