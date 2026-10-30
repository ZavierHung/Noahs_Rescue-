"use client";
import { useEffect, useRef, useState } from "react";
import type { Game, Card } from "@/lib/expedition";
import { CardHint } from "../game/card-hint";
import {
  emptyBag,
  ResourceBag,
  ResourceFields,
  RESOURCE_KEYS,
} from "./resources";

type Props = {
  game: Game;
  card: Card;
  invitation: string | null;
  busy: boolean;
  readOnly: boolean;
  error: string;
  onClose: () => void;
  onReturn: () => void;
  act: (type: string, data?: Record<string, unknown>) => Promise<boolean>;
};
export function TradePanel({
  game: g,
  card,
  invitation,
  busy,
  readOnly,
  error,
  onClose,
  onReturn,
  act,
}: Props) {
  const panel = useRef<HTMLElement>(null);
  const [targetId, setTarget] = useState("");
  const [give, setGive] = useState(emptyBag),
    [receive, setReceive] = useState(emptyBag);
  const pending = g.pending?.kind === "trade" ? g.pending : null;
  const actor = g.players.find((p) => p.id === g.activePlayerId)!;
  const owner = g.players.find((p) => p.id === pending?.owner);
  const target = g.players.find((p) => p.id === targetId);
  const beacon = pending?.beacon || invitation === "beacon";
  const targets = g.trade?.targets || [];
  const total = (bag: ReturnType<typeof emptyBag>) =>
    RESOURCE_KEYS.reduce((n, r) => n + bag[r], 0);
  const problem = !g.trade
    ? "规则信息尚未加载，请刷新页面后重试。"
    : (beacon
        ? g.trade.beaconBlockedReason
        : g.trade.invitationBlockedReason) ||
      (!targets.some((t) => t.contact)
        ? "当前没有已建立联络的玩家。请先移动到其他玩家同格或相邻格，再使用邀约。"
        : "") ||
      (!total(actor.resources) ? "你还没有可交换的物资，请先采集资源。" : "") ||
      (!target ? "先选择一位已建立联络的玩家。" : "") ||
      (!targets.find((t) => t.playerId === targetId)?.contact
        ? "对方位置已变化，请重新选择同格或相邻玩家。"
        : "") ||
      (!total(give) || !total(receive)
        ? "设置你给出的物资和希望收到的物资，双方至少各 1 份。"
        : "") ||
      (beacon && (total(give) !== 1 || total(receive) !== 1)
        ? "互助信标每次双方只能各交换 1 份。"
        : "") ||
      (RESOURCE_KEYS.some(
        (r) =>
          give[r] > actor.resources[r] ||
          receive[r] > (target?.resources[r] || 0),
      )
        ? "交换数量超过当前库存，请调整数量。"
        : "");
  useEffect(() => {
    if (readOnly) return;
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [invitation, pending?.actor, readOnly]);
  return (
    <section
      ref={panel}
      tabIndex={-1}
      className={`trade-panel ${pending ? "trade-response" : "trade-form"}`}
      aria-label="邀约交换流程"
    >
      <div className="interaction-heading">
        <CardHint card={card}>
          <img
            src={
              beacon
                ? "/images/expedition/cards/aid-beacon.jpg"
                : "/images/expedition/cards/invitation.jpg"
            }
            alt={beacon ? "互助信标" : "邀约卡"}
          />
        </CardHint>
        <div>
          <p className="overline">
            INVITATION / {pending ? "02 · 等待对方回应" : "01 · 提出交换"}
          </p>
          <h2>
            {pending
              ? "收到资源交换请求"
              : `${beacon ? "互助信标" : "邀约卡"} · 选择对象与物资`}
          </h2>
          <p>
            {pending
              ? `${owner?.id} · ${owner?.name} → ${actor.id} · ${actor.name}，现在请受邀玩家回应。`
              : `${actor.id} · ${actor.name} 发起；只有对方接受后才转移物资。`}
          </p>
        </div>
      </div>
      <ol className="interaction-steps" aria-label="邀约步骤">
        <li className={!pending ? "active" : ""}>1 选择对象与物资</li>
        <li className={pending ? "active" : ""}>2 对方接受 / 拒绝</li>
        <li>3 结算并返回原玩家</li>
      </ol>
      {error && (
        <p className="interaction-warning" role="alert">
          {error}
        </p>
      )}
      {readOnly ? (
        <div className="interaction-warning">
          <p>
            你正在只读查看其他玩家。此次请求只允许 {actor.id} · {actor.name}{" "}
            回应。
          </p>
          <button onClick={onReturn}>切换到受邀玩家回应</button>
        </div>
      ) : pending ? (
        <>
          <div className="exchange-columns">
            <div>
              <h3>你将获得</h3>
              <ResourceBag value={pending.give} hideZero />
            </div>
            <div>
              <h3>你需交出</h3>
              <ResourceBag value={pending.receive} hideZero />
            </div>
          </div>
          {g.trade?.response?.reason && (
            <p className="interaction-warning" role="status">
              {g.trade.response.reason}
            </p>
          )}
          <div className="two-buttons">
            <button
              className="primary"
              disabled={busy || !g.trade?.response || !!g.trade.response.reason}
              onClick={() => void act("choose", { accept: true })}
            >
              接受交换
            </button>
            <button
              disabled={busy}
              onClick={() => void act("choose", { accept: false })}
            >
              拒绝
            </button>
          </div>
          <p className="fineprint">
            接受：双方物资一次结算，
            {beacon ? "记为本回合已使用互助信标，不消耗邀约卡" : "消耗邀约卡"}
            。拒绝：不扣物资、不消耗邀约卡，可换人重试。完成后返回 {
              owner?.id
            }{" "}
            的原行动步骤。
          </p>
        </>
      ) : (
        <>
          <label>
            选择已建立联络的玩家
            <select
              aria-label="邀约对象"
              disabled={busy || !targets.some((t) => t.contact)}
              value={targetId}
              onChange={(e) => {
                setTarget(e.target.value);
                setReceive(emptyBag());
              }}
            >
              <option value="">选择交换对象</option>
              {targets.map((t) => (
                <option
                  key={t.playerId}
                  value={t.playerId}
                  disabled={!t.contact}
                >
                  {t.playerId} ·{" "}
                  {g.players.find((p) => p.id === t.playerId)?.name} ·{" "}
                  {t.contact ? "已联络" : `未联络 · 距离 ${t.distance} 格`}
                </option>
              ))}
            </select>
          </label>
          <div className="exchange-columns">
            <div>
              <h3>你给对方</h3>
              <ResourceFields
                label="给出"
                value={give}
                onChange={setGive}
                max={actor.resources}
                disabled={busy}
              />
            </div>
            <div>
              <h3>希望对方给你</h3>
              <ResourceFields
                label="请求"
                value={receive}
                onChange={setReceive}
                max={target?.resources || emptyBag()}
                disabled={busy || !target}
              />
            </div>
          </div>
          <p
            className={problem ? "interaction-warning" : "interaction-ready"}
            role="status"
          >
            {problem || "条件满足，发送后将切换到对方的接受 / 拒绝界面。"}
          </p>
          <div className="two-buttons">
            <button
              className="primary"
              disabled={busy || !!problem}
              onClick={() =>
                void act(beacon ? "beacon" : "play", {
                  cardUid: invitation,
                  targetId,
                  give,
                  receive,
                })
              }
            >
              发送交换请求
            </button>
            <button disabled={busy} onClick={onClose}>
              取消
            </button>
          </div>
          <p className="fineprint">
            当前“建立联络”指同格或相邻。默认开局各玩家距离较远且没有物资，需要先移动、采集，再交换；点击使用不会立即弃掉邀约卡。
          </p>
        </>
      )}
    </section>
  );
}
