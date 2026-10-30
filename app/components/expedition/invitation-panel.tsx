"use client";
import { useEffect, useRef, useState } from "react";
import type { Game, Resource, Card } from "@/lib/expedition";
import { CardHint } from "../game/card-hint";
import {
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  ResourceAmount,
  ResourceIcon,
} from "./resources";
export function InvitationPanel({
  game: g,
  card,
  cardUid,
  busy,
  readOnly,
  error,
  onClose,
  onReturn,
  act,
}: {
  game: Game;
  card: Card;
  cardUid: string | null;
  busy: boolean;
  readOnly: boolean;
  error: string;
  onClose: () => void;
  onReturn: () => void;
  act: (type: string, data?: Record<string, unknown>) => Promise<boolean>;
}) {
  const panel = useRef<HTMLElement>(null),
    [targetId, setTarget] = useState(""),
    [resource, setResource] = useState<Resource>("wood");
  const pending = g.pending?.kind === "invitation" ? g.pending : null;
  const actor = g.players.find((p) => p.id === g.activePlayerId)!;
  const owner = g.players.find((p) => p.id === pending?.owner);
  const problem = pending
    ? g.invitation.responseReason
    : g.invitation.blockedReason ||
      (!g.invitation.targets.some((t) => t.eligible)
        ? "没有可邀约的其他玩家"
        : !g.invitation.targets.some(
              (t) => t.playerId === targetId && t.eligible,
            )
          ? "请选择最近两名玩家中的一位"
          : "");
  useEffect(() => {
    if (!readOnly) {
      panel.current?.focus({ preventScroll: true });
      panel.current?.scrollIntoView({ block: "start" });
    }
  }, [pending?.actor, cardUid, readOnly]);
  return (
    <section
      ref={panel}
      tabIndex={-1}
      className="trade-panel invitation-panel"
      aria-label="邀约领取流程"
    >
      <div className="interaction-heading">
        <CardHint card={card}>
          <img src={card.image} alt="邀约卡原图" />
        </CardHint>
        <div>
          <p className="overline">INVITATION / 共同获得物资</p>
          <h2>{pending ? "收到资源邀约" : "邀约卡 · 选择同伴与资源"}</h2>
          <p>不是交换，不需要现有库存；接受后双方各增加一份自己想要的资源。</p>
        </div>
      </div>
      <ol className="interaction-steps">
        <li className={!pending ? "active" : ""}>1 选择最近同伴</li>
        <li className={pending ? "active" : ""}>2 对方选资源并回应</li>
        <li>3 双方领取 · 返回原玩家</li>
      </ol>
      {error && (
        <p className="interaction-warning" role="alert">
          {error}
        </p>
      )}
      {readOnly ? (
        <div className="interaction-warning">
          <p>
            只读查看；现在请 {actor.id} · {actor.name} 回应。
          </p>
          <button onClick={onReturn}>切换到受邀玩家回应</button>
        </div>
      ) : (
        <>
          {pending ? (
            <p>
              {owner?.id} · {owner?.name} 邀请你，接受后对方获得{" "}
              <ResourceAmount resource={pending.resource} amount={1} />
              ；你可独立选择以下任意一种。
            </p>
          ) : (
            <label>
              物理位置最近的两名其他玩家
              <select
                aria-label="邀约对象"
                value={targetId}
                disabled={busy}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">选择邀约对象</option>
                {g.invitation.targets.map((t) => (
                  <option
                    key={t.playerId}
                    value={t.playerId}
                    disabled={!t.eligible}
                  >
                    {t.playerId} ·{" "}
                    {g.players.find((p) => p.id === t.playerId)?.name} ·
                    距离排序 {t.rank}
                    {!t.eligible ? "（不可选）" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <fieldset className="resource-output">
            <legend>
              {pending ? "你想获得的资源" : "我想获得的资源"} · 1 份
            </legend>
            <div className="resource-options">
              {RESOURCE_KEYS.map((r) => (
                <button
                  key={r}
                  disabled={busy}
                  aria-label={`想要${RESOURCE_LABELS[r]}`}
                  aria-pressed={resource === r}
                  onClick={() => setResource(r)}
                >
                  <ResourceIcon resource={r} /> +1
                </button>
              ))}
            </div>
          </fieldset>
          <p
            className={problem ? "interaction-warning" : "interaction-ready"}
            role="status"
          >
            {problem ||
              (pending
                ? "只有你接受，双方才获得物资；拒绝不会消耗邀约卡。"
                : "零库存也可邀约。对方自行选择自己的资源，与你所选种类无关。")}
          </p>
          <div className="two-buttons">
            <button
              className="primary"
              disabled={busy || !!problem}
              onClick={() =>
                void act(
                  pending ? "choose" : "play",
                  pending
                    ? { accept: true, resource }
                    : { cardUid, targetId, resource },
                )
              }
            >
              {pending ? "接受邀约并领取" : "发送邀约"}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                pending ? void act("choose", { accept: false }) : onClose()
              }
            >
              {pending ? "拒绝" : "取消"}
            </button>
          </div>
        </>
      )}
      <p className="fineprint">
        以发起者为中心按地图直线距离选最近两人；同距离按座位号排序。卡面保留原图，旧版“交换”文字以此新版规则为准。互助信标仍是相邻格一换一。
      </p>
    </section>
  );
}
