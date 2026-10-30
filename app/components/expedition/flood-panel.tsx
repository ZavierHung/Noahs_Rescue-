"use client";
import { useEffect, useRef, useState } from "react";
import type { Game, Resource } from "@/lib/expedition";
import {
  emptyBag,
  ResourceAmount,
  ResourceBag,
  ResourceIcon,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
} from "./resources";

export function FloodPanel({
  game: g,
  busy,
  readOnly,
  act,
  onReturn,
}: {
  game: Game;
  busy: boolean;
  readOnly: boolean;
  onReturn: () => void;
  act: (type: string, data?: Record<string, unknown>) => Promise<boolean>;
}) {
  const ref = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState<Resource | null>(null);
  const event = g.events.findLast(
    (e) => e.type === "flood" && e.round === g.round,
  );
  const p = g.players.find((p) => p.id === g.activePlayerId)!;
  const cost = g.pending?.kind === "flood" ? g.pending.cost : null;
  const available: Resource[] = cost?.optional
    ? cost.choices.filter((r: Resource) => p.resources[r] > cost.mandatory[r])
    : [];
  const payable = emptyBag();
  for (const r of RESOURCE_KEYS)
    payable[r] = cost ? Math.min(p.resources[r], cost.mandatory[r]) : 0;
  if (selected && available.includes(selected)) payable[selected]++;
  useEffect(() => {
    setSelected(null);
    if (readOnly) return;
    ref.current?.focus({ preventScroll: true });
    ref.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [g.round, g.pending?.kind, g.pending?.actor, readOnly]);
  return (
    <section
      ref={ref}
      tabIndex={-1}
      className="flood-panel"
      aria-label="洪水扣除与缴纳明细"
    >
      <div className="interaction-heading">
        <span className="flood-wave" aria-hidden="true">
          ≋
        </span>
        <div>
          <p className="overline">FLOOD WARNING / 第 {g.floodLevel} 次洪水</p>
          <h2>洪水已到来 · 请逐人结算</h2>
          <p>
            本轮淹没 Zone {4 - g.floodLevel}
            ，外侧区域持续淹没。缴纳不是捐赠，不计入方舟贡献。
          </p>
        </div>
      </div>
      <div className="flood-ark" aria-label="方舟本次扣除">
        <p className="interaction-warning">
          欠缴每份增加 1 点伤势。终局种子每份恢复 {g.rules.seedRecovery}{" "}
          点，剩余伤势超过 {g.rules.floodInjuryTolerance}{" "}
          则不能生存。当前玩家累计伤势 {p.floodInjury || 0}。
        </p>
        <h3>方舟已自动扣除</h3>
        {event ? (
          <>
            <p>
              骰子 <strong>{String(event.die)}</strong> · 应扣{" "}
              {String(event.requested)} 份
            </p>
            <ResourceAmount
              resource={event.resource as Resource}
              amount={Number(event.actual)}
            />
            <p>
              实际扣除 {String(event.actual)} 份
              {Number(event.actual) < Number(event.requested)
                ? "（库存不足，仅扣现有物资）"
                : ""}
              ；不会在个人确认时重复扣除。
            </p>
          </>
        ) : (
          <p>请在全局日志查看本次方舟扣除记录。</p>
        )}
      </div>
      {cost ? (
        <>
          <h3>支付本次洪水损失</h3>
          <p className="flood-player">
            现在由 {p.id} · {p.name} 缴纳{" "}
            <span>
              {g.pending.index + 1} / {g.players.length} 人
            </span>
          </p>
          <div className="flood-cost-grid">
            <div>
              <h4>① 固定扣除</h4>
              <ResourceBag value={cost.mandatory} hideZero />
              <p>不足的资源只扣现有量，不会变成负数。</p>
            </div>
            <div>
              <h4>② 额外选扣</h4>
              {cost.optional ? (
                <>
                  <p>以下物资任选 1 份（固定扣除后仍需有剩余）：</p>
                  <span className="resource-bag">
                    {cost.choices.map((r: Resource) => (
                      <ResourceIcon key={r} resource={r} />
                    ))}
                  </span>
                </>
              ) : (
                <p>无需额外选扣</p>
              )}
              {p.equipment.includes("reserve-crate") && (
                <p className="reserve-notice">
                  储备仓生效：已按现有物资计算最多 1 份减免。
                </p>
              )}
            </div>
          </div>
          {readOnly ? (
            <div className="interaction-warning">
              <p>当前为只读查看，只有 {p.id} 可以确认这笔缴纳。</p>
              <button onClick={onReturn}>返回缴纳玩家</button>
            </div>
          ) : (
            <>
              {!!available.length && (
                <div className="flood-options" aria-label="选择额外扣除物资">
                  {available.map((r) => (
                    <button
                      key={r}
                      aria-label={`选择扣除${RESOURCE_LABELS[r]}`}
                      aria-pressed={selected === r}
                      disabled={busy}
                      onClick={() => setSelected(r)}
                    >
                      <ResourceAmount resource={r} amount={1} />
                      <small>剩余 {p.resources[r] - cost.mandatory[r]}</small>
                    </button>
                  ))}
                </div>
              )}
              {!!cost.optional && !available.length && (
                <p className="interaction-warning">
                  固定扣除后没有可选物资，额外扣除为 0。
                </p>
              )}
              <div className="flood-total" aria-label="本次实际缴纳预览">
                <strong>
                  {available.length && !selected
                    ? "固定部分实际扣除（请选择额外物资）"
                    : "本次实际缴纳合计"}
                </strong>
                <ResourceBag value={payable} hideZero />
                <small>
                  按当前选择，欠缴伤势 +
                  {Math.max(
                    0,
                    RESOURCE_KEYS.reduce(
                      (n, r) => n + cost.mandatory[r] - payable[r],
                      0,
                    ) + cost.optional,
                  )}
                  {available.length && !selected
                    ? "（选择额外物资后更新）"
                    : ""}
                </small>
              </div>
              <button
                className="primary flood-confirm"
                disabled={
                  busy ||
                  (!!available.length &&
                    (!selected || !available.includes(selected)))
                }
                onClick={() =>
                  void act(
                    "pay_flood",
                    selected && available.includes(selected)
                      ? { resource: selected }
                      : {},
                  )
                }
              >
                {available.length
                  ? "确认缴纳本次物资"
                  : "确认本次扣除 / 无可扣资源"}
              </button>
            </>
          )}
        </>
      ) : (
        <p className="interaction-warning">
          {g.pending?.kind === "blade"
            ? "个人缴纳已结束，请在行动区处理名刀逃生。"
            : "洪水结算暂时暂停，请先处理当前科技或灾难选择，随后继续缴纳。"}
        </p>
      )}
      {g.events.some(
        (e) => e.round === g.round && e.type === "flood_payment",
      ) && (
        <details className="flood-paid">
          <summary>查看已缴纳玩家与实际损失</summary>
          {g.events
            .filter((e) => e.round === g.round && e.type === "flood_payment")
            .map((e) => (
              <p key={e.seq}>
                {e.actor}：
                <ResourceBag
                  value={e.lost as ReturnType<typeof emptyBag>}
                  hideZero
                />
              </p>
            ))}
        </details>
      )}
    </section>
  );
}
