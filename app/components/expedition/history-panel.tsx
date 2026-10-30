"use client";
import { useEffect, useRef, useState } from "react";
import type { Game, HistoryAction } from "@/lib/expedition";

export function HistoryPanel({
  game,
  busy,
  readOnly,
  act,
}: {
  game: Game;
  busy: boolean;
  readOnly: boolean;
  act: (type: string, data?: Record<string, unknown>) => Promise<boolean>;
}) {
  const [confirmation, setConfirmation] = useState<{
    type: "undo" | "redo";
    revision: number;
    action: HistoryAction;
  } | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const redoButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmation) cancelButton.current?.focus();
  }, [confirmation]);
  useEffect(() => {
    if (readOnly) setConfirmation(null);
  }, [readOnly]);
  function cancel() {
    const button = confirmation?.type === "redo" ? redoButton : undoButton;
    setConfirmation(null);
    // The opener is disabled while confirmation is open; focus after React
    // has removed that disabled state, not before the update commits.
    requestAnimationFrame(() => button.current?.focus());
  }
  const h = game.history;
  if (!h) return null;
  const disabled = busy || readOnly || !!h.lockedReason;
  const stale = confirmation?.revision !== game.revision;
  return (
    <section className="history-panel" aria-label="操作撤回与重做">
      <div className="history-toolbar">
        <div>
          <strong>行动修正</strong>
          <p>
            {h.lockedReason ||
              (readOnly
                ? "当前为只读查看；返回当前行动玩家后才能撤回或重做。"
                : `由 ${h.actorId} 确认整局回退 · 最近 ${h.limit} 步 · 刷新后仍保留`)}
          </p>
        </div>
        <div className="history-buttons">
          <button
            ref={undoButton}
            disabled={disabled || !h.undo || !!confirmation}
            onClick={() =>
              h.undo &&
              setConfirmation({
                type: "undo",
                revision: game.revision,
                action: h.undo,
              })
            }
          >
            ↶ 撤回上一步{h.undoCount > 0 ? `（${h.undoCount}）` : ""}
          </button>
          <button
            ref={redoButton}
            disabled={disabled || !h.redo || !!confirmation}
            onClick={() =>
              h.redo &&
              setConfirmation({
                type: "redo",
                revision: game.revision,
                action: h.redo,
              })
            }
          >
            ↷ 重做{h.redoCount > 0 ? `（${h.redoCount}）` : ""}
          </button>
        </div>
      </div>
      {confirmation && !readOnly && (
        <div
          className="history-confirm"
          role="alertdialog"
          aria-labelledby="history-confirm-title"
          aria-describedby="history-confirm-detail"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy) {
              e.stopPropagation();
              cancel();
            }
          }}
        >
          <h3 id="history-confirm-title">
            确认{confirmation.type === "undo" ? "撤回" : "重做"}这一步？
          </h3>
          <p className="history-action">
            R{confirmation.action.round} · {confirmation.action.actor} ·{" "}
            {confirmation.action.label}
          </p>
          <p id="history-confirm-detail">
            这是整局操作：相关玩家资源、卡牌、位置、世界分数、洪水和回合将一起恢复，可能切换行动玩家。抽牌和骰点保持原结果。
          </p>
          <p className="fineprint">
            开始上帝审议后不可回退。撤回后执行新操作将清空重做分支；所有修正都会留档。
          </p>
          {stale && (
            <p role="status">
              状态已更新，请取消后重新选择，避免撤回错误的一步。
            </p>
          )}
          <div className="history-buttons">
            <button ref={cancelButton} disabled={busy} onClick={cancel}>
              取消，保持现状
            </button>
            <button
              className="primary"
              disabled={disabled || stale}
              onClick={async () => {
                if (
                  await act(confirmation.type, {
                    revision: confirmation.revision,
                  })
                )
                  setConfirmation(null);
              }}
            >
              确认{confirmation.type === "undo" ? "撤回" : "重做"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
