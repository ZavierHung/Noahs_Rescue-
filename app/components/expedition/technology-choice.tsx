"use client";
import { useState } from "react";
import type { Bag, Card, Game, Resource } from "@/lib/expedition";
import { CardHint } from "../game/card-hint";
import {
  emptyBag,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  ResourceFields,
  ResourceIcon,
} from "./resources";

export function TechnologyChoice({
  game,
  cards,
  busy,
  act,
  onPreview,
}: {
  game: Game;
  cards: Card[];
  busy: boolean;
  act: (type: string, data?: Record<string, unknown>) => Promise<boolean>;
  onPreview: (card: Card) => void;
}) {
  const [selected, setSelected] = useState("");
  const [spend, setSpend] = useState<Bag>(emptyBag);
  const [resource, setResource] = useState<Resource>("wood");
  const [target, setTarget] = useState("");
  const player = game.players.find((p) => p.id === game.activePlayerId)!;
  const card = cards.find((c) => c.id === selected);
  const option = game.technology?.choices.find((c) => c.id === selected);
  const total = RESOURCE_KEYS.reduce((n, r) => n + spend[r], 0);
  const problem =
    option?.blockedReason ||
    (selected === "alchemy-furnace" &&
    (total !== 2 || RESOURCE_KEYS.some((r) => spend[r] > player.resources[r]))
      ? "请选择两份持有物资作为炼金消耗"
      : "") ||
    (selected === "recycling-claw" &&
    !option?.targets.some((t) => t.playerId === target && !t.reason)
      ? "请选择一位可争夺的同格或相邻玩家"
      : "");
  return (
    <div className="technology-choice" aria-label="科技选择与条件">
      <div className="tech-options">
        {game.pending.choices.map((id: string, index: number) => {
          const c = cards.find((row) => row.id === id)!;
          const state = game.technology?.choices.find((row) => row.id === id);
          return (
            <div key={index} className={selected === id ? "chosen" : ""}>
              <CardHint card={c}>
                <button
                  className="art-button"
                  aria-label={`查看${c.name}卡面`}
                  onClick={() => onPreview(c)}
                >
                  <img src={c.image} alt={c.name} />
                </button>
              </CardHint>
              <button
                disabled={busy}
                aria-pressed={selected === id}
                onClick={() => {
                  setSelected(id);
                  setTarget("");
                  setSpend(emptyBag());
                }}
              >
                {c.name}
              </button>
              <small>
                {state?.blockedReason || state?.warning || c.effectSummary}
              </small>
            </div>
          );
        })}
      </div>
      {card && (
        <>
          <p>{card.implementedEffect || card.effect}</p>
          {option?.warning && <p className="fineprint">{option.warning}</p>}
          {selected === "alchemy-furnace" && (
            <>
              <ResourceFields
                value={spend}
                onChange={setSpend}
                label="炼金消耗"
                max={player.resources}
                disabled={busy}
              />
              <fieldset className="resource-output" disabled={busy}>
                <legend>产出资源 · 获得三份</legend>
                <div className="resource-options">
                  {RESOURCE_KEYS.map((r) => (
                    <button
                      key={r}
                      aria-label={`产出${RESOURCE_LABELS[r]}`}
                      aria-pressed={resource === r}
                      onClick={() => setResource(r)}
                    >
                      <ResourceIcon resource={r} />
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          )}
          {selected === "recycling-claw" && (
            <label>
              同格或相邻目标
              <select
                aria-label="科技目标"
                disabled={busy}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">选择玩家</option>
                {option?.targets.map((t) => (
                  <option
                    key={t.playerId}
                    value={t.playerId}
                    disabled={!!t.reason}
                  >
                    {t.playerId} ·{" "}
                    {game.players.find((p) => p.id === t.playerId)?.name} ·{" "}
                    {t.reason ||
                      (t.empty ? "无资源，改抽一张行动牌" : "可争夺一份资源")}
                  </option>
                ))}
              </select>
            </label>
          )}
          {problem && (
            <p role="status" className="interaction-warning">
              {problem}
            </p>
          )}
          <button
            className="primary"
            disabled={busy || !!problem}
            onClick={() =>
              void act("choose", {
                techId: selected,
                spend,
                resource,
                targetId: target,
              })
            }
          >
            获得 {card.name} 的收益
          </button>
        </>
      )}
      <button
        disabled={busy}
        onClick={() => void act("choose", { decline: true })}
      >
        放弃本次科技收益
      </button>
    </div>
  );
}
