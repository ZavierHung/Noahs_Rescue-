import { requireRule } from "./runtime.js";

// Whole-command checkpoints: automatic draws, cascades and turn changes belong
// to the command that caused them. Never nest history/audit inside a snapshot.
export const HISTORY_LIMIT = 20;
export function gameplayState(game) {
  const { historyState, historyAudit, ...state } = game;
  return structuredClone(state);
}
const stacks = (g) => g.historyState || { version: 1, undo: [], redo: [] };
const actorId = (g) => g.pending?.actor || g.players[g.turn]?.id;
const locked = (g) =>
  !!g.judgment || !["playing", "awaiting_judgment"].includes(g.status);
const summary = ({ snapshot, events, eventCount, ...entry }) => entry;
function checkpoint(game) {
  // Events are append-only in gameplay. Store just this command's event suffix
  // separately, not 20 copies of the growing log. All mutable state stays whole.
  const { historyState, historyAudit, events, ...state } = game;
  return structuredClone(state);
}

export function historyView(game) {
  const state = stacks(game),
    disabled = locked(game);
  return {
    limit: HISTORY_LIMIT,
    actorId: actorId(game),
    lockedReason: disabled
      ? "上帝审议已开始，航程证据已锁定，不能撤回或重做"
      : "",
    undoCount: disabled ? 0 : state.undo.length,
    redoCount: disabled ? 0 : state.redo.length,
    undo: !disabled && state.undo.length ? summary(state.undo.at(-1)) : null,
    redo: !disabled && state.redo.length ? summary(state.redo.at(-1)) : null,
    lastChangeRevision: game.historyAudit?.at(-1)?.revision || 0,
  };
}

export function recordAction(original, updated, input) {
  const state = stacks(original);
  const entry = {
    id: `action-${updated.revision}`,
    actor: input.actor,
    type: input.type,
    label: updated.events.at(-1)?.detail || input.type,
    round: original.round,
    phase: original.phase,
    revision: updated.revision,
    snapshot: checkpoint(original),
    eventCount: original.events.length,
    events: structuredClone(updated.events.slice(original.events.length)),
  };
  updated.historyState = {
    version: 1,
    undo: [...state.undo, entry].slice(-HISTORY_LIMIT),
    redo: [],
  };
  updated.historyAudit = [...(original.historyAudit || [])];
  if (state.redo.length) {
    updated.historyAudit.push({
      seq: updated.historyAudit.length + 1,
      type: "branch",
      actor: input.actor,
      round: original.round,
      revision: updated.revision,
      at: new Date().toISOString(),
      detail: "撤回后执行了新操作，原重做分支已关闭",
      discarded: state.redo.map(summary),
    });
  }
  return updated;
}

export function restoreHistory(original, input) {
  requireRule(!locked(original), "上帝审议已开始，不能撤回或重做");
  requireRule(
    input.actor === actorId(original),
    "请由当前行动玩家操作撤回或重做",
  );
  const direction = input.type,
    other = direction === "undo" ? "redo" : "undo";
  const state = stacks(original),
    entry = state[direction].at(-1);
  requireRule(
    entry,
    direction === "undo" ? "没有可撤回的操作" : "没有可重做的操作",
  );
  const restored = gameplayState(entry.snapshot);
  if (Number.isInteger(entry.eventCount)) {
    requireRule(
      original.events.length ===
        entry.eventCount + (direction === "undo" ? entry.events.length : 0),
      "历史与当前日志不一致，无法安全恢复",
    );
    restored.events =
      direction === "undo"
        ? structuredClone(original.events.slice(0, entry.eventCount))
        : structuredClone([...original.events, ...entry.events]);
  }
  // Revisions always advance, including when gameplay moves back in time.
  restored.revision = original.revision + 1;
  restored.historyState = {
    version: 1,
    [direction]: state[direction].slice(0, -1),
    [other]: [
      ...state[other],
      {
        ...entry,
        snapshot: Number.isInteger(entry.eventCount)
          ? checkpoint(original)
          : gameplayState(original),
      },
    ].slice(-HISTORY_LIMIT),
  };
  const events =
    direction === "undo"
      ? original.events.slice(restored.events.length)
      : restored.events.slice(original.events.length);
  restored.historyAudit = [
    ...(original.historyAudit || []),
    {
      seq: (original.historyAudit?.length || 0) + 1,
      type: direction,
      actor: input.actor,
      round: original.round,
      revision: restored.revision,
      sourceRevision: original.revision,
      snapshotRevision: entry.snapshot.revision,
      at: new Date().toISOString(),
      detail: `${direction === "undo" ? "撤回" : "重做"}：${entry.label}`,
      action: summary(entry),
      // Separate audit, NOT effective game.events / god evidence. Seq numbers
      // in this archived branch are local to that revision, not the live branch.
      events: structuredClone(events),
    },
  ];
  return restored;
}
