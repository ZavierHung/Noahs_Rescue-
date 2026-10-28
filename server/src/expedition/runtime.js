import { RESOURCES } from "./catalog.js";
export const bag = () => Object.fromEntries(RESOURCES.map((r) => [r, 0]));
export const sum = (b) => RESOURCES.reduce((n, r) => n + (b[r] || 0), 0);
export const clamp = (n) => Math.max(1, Math.min(19, n));
export const requireRule = (condition, message) => {
  if (!condition) throw Object.assign(new Error(message), { status: 400 });
};
export const random = (g) => {
  g.rng = (Math.imul(g.rng, 1664525) + 1013904223) >>> 0;
  return g.rng / 4294967296;
};
export const log = (g, actor, type, detail, data = {}) =>
  g.events.push({
    seq: g.events.length + 1,
    round: g.round,
    turn: g.turn,
    actor,
    type,
    detail,
    ...data,
  });
