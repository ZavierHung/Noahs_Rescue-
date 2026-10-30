"use client";
import { useEffect, useRef } from "react";
import type {
  Game,
  PublicEventOption,
  PublicEventPending,
} from "@/lib/expedition";
import { CardHint } from "../game/card-hint";
import { ResourceIcon, RESOURCE_KEYS, RESOURCE_LABELS } from "./resources";

const WORLD_LABELS = {
  economy: "经济",
  environment: "环境",
  society: "社会",
} as const;
const signed = (value: number) =>
  value > 0 ? `+${value}` : `−${Math.abs(value)}`;
function effectText(option: PublicEventOption) {
  const ark = RESOURCE_KEYS.filter((key) => option.effects.ark[key]).map(
    (key) => `${RESOURCE_LABELS[key]}${signed(option.effects.ark[key]!)}`,
  );
  const world = Object.entries(option.effects.world)
    .filter(([, value]) => value)
    .map(
      ([key, value]) =>
        `${WORLD_LABELS[key as keyof typeof WORLD_LABELS]}${signed(value!)}`,
    );
  return `${option.summary} 方舟：${ark.join("、") || "不变"}；共享世界：${world.join("、") || "不变"}。`;
}

export function PublicEventPanel({
  game: g,
  busy,
  readOnly,
  act,
  onReturn,
}: {
  game: Game;
  busy: boolean;
  readOnly: boolean;
  act: (type: string, data?: Record<string, unknown>) => Promise<boolean>;
  onReturn: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const pending =
    g.pending?.kind === "public_event"
      ? (g.pending as PublicEventPending)
      : null;
  useEffect(() => {
    if (pending && !readOnly) {
      panel.current?.focus({ preventScroll: true });
      panel.current?.scrollIntoView({ block: "start" });
    }
  }, [pending?.card.id, pending?.actor, readOnly]);
  if (!g.learningMode || !g.publicEvents || !pending) return null;
  const actor = g.players.find((p) => p.id === pending.actor);
  const { card } = pending;
  return (
    <section
      ref={panel}
      id="public-event-decision"
      className="public-event-panel"
      aria-label="公共事件二选一"
      tabIndex={-1}
    >
      <div className="public-event-heading">
        <div>
          <p className="overline">
            THE COMMON CHOICE / 本局第 {pending.sequence} / 3 次公共事件
          </p>
          <h2>{card.title}</h2>
          <p>{card.description}</p>
        </div>
        <span className="public-event-round">R{g.round}</span>
      </div>
      <p className="public-event-actor">
        轮到{" "}
        <strong>
          {actor?.id} · {actor?.name}
        </strong>{" "}
        作出公共选择。两种结果都已公开，提交后会留档。
      </p>
      {readOnly && (
        <div className="interaction-warning">
          正在只读查看其他玩家；只有轮值决策者可以选择。
          <button onClick={onReturn}>返回公共事件决策者</button>
        </div>
      )}
      <div className="public-event-options">
        {card.options.map((option) => (
          <CardHint
            key={option.id}
            card={{
              name: `${card.title}：${option.label}`,
              effectSummary: effectText(option),
            }}
            className="public-event-hint"
          >
            <button
              type="button"
              className="public-event-option"
              disabled={busy || readOnly}
              onClick={() => void act("choose", { optionId: option.id })}
              aria-label={`选择公共方案：${option.label}`}
            >
              <strong>{option.label}</strong>
              <span className="public-event-summary">{option.summary}</span>
              <span className="public-event-effects">
                <span className="public-effect-label">共同方舟</span>
                {RESOURCE_KEYS.filter((key) => option.effects.ark[key]).map(
                  (key) => (
                    <span
                      className="resource-amount"
                      key={key}
                      aria-label={`方舟${RESOURCE_LABELS[key]} ${signed(option.effects.ark[key]!)}`}
                    >
                      <ResourceIcon resource={key} />
                      <b>{signed(option.effects.ark[key]!)}</b>
                    </span>
                  ),
                )}
                {!RESOURCE_KEYS.some((key) => option.effects.ark[key]) && (
                  <span>不变</span>
                )}
              </span>
              <span className="public-event-effects">
                <span className="public-effect-label">共享世界</span>
                {Object.entries(option.effects.world)
                  .filter(([, value]) => value)
                  .map(([key, value]) => (
                    <span className="public-world-delta" key={key}>
                      {WORLD_LABELS[key as keyof typeof WORLD_LABELS]}{" "}
                      {signed(value!)}
                    </span>
                  ))}
                {!Object.values(option.effects.world).some(Boolean) && (
                  <span>不变</span>
                )}
              </span>
              <span className="public-event-confirm">
                {readOnly ? "仅查看方案" : "选择此方案 →"}
              </span>
            </button>
          </CardHint>
        ))}
      </div>
      <div className="public-event-learning">
        <p>
          <strong>这一轮的思考</strong> · {card.concept}
        </p>
        <p>
          <strong>模型边界</strong> · {card.limitations}
        </p>
      </div>
      <small>
        公共收益不计个人捐赠，世界变化也不自动算个人功劳。数值受 1—19
        边界约束，以结算日志为准；完成后继续正常回合。
      </small>
    </section>
  );
}
