"use client";
import { useEffect, useState } from "react";
import type { Game, Tile, WorldAttributes } from "@/lib/expedition";
const dimensions = [
  { key: "economy", label: "经济" },
  { key: "environment", label: "环境" },
  { key: "society", label: "社会" },
] as const;
type Props = {
  game: Game;
  busy: boolean;
  readOnly?: boolean;
  tile?: Tile;
  act: (type: string, data?: Record<string, unknown>) => Promise<boolean>;
};
export function WorldPanel({
  game: g,
  busy,
  readOnly = false,
  tile,
  act,
}: Props) {
  const [draft, setDraft] = useState<WorldAttributes>(g.world.base),
    [revision, setRevision] = useState(g.revision),
    [dirty, setDirty] = useState(false),
    [reason, setReason] = useState(""),
    [protectionReason, setProtectionReason] = useState("");
  useEffect(() => {
    if (!dirty) {
      setDraft(g.world.base);
      setRevision(g.revision);
    }
  }, [g.id, g.revision, dirty]);
  const locked = readOnly || busy || g.status !== "playing" || !!g.pending,
    stale = dirty && revision !== g.revision;
  function update(key: keyof WorldAttributes, value: number) {
    setDirty(true);
    setDraft((old) => ({
      ...old,
      [key]: Math.max(1, Math.min(19, Math.round(value) || 1)),
    }));
  }
  async function save() {
    if (await act("set_world", { attributes: draft, reason, revision })) {
      setDirty(false);
      setReason("");
    }
  }
  async function protect(outcome: string) {
    if (
      await act("confirm_protection", {
        outcome,
        tileId: tile?.id,
        reason: protectionReason,
      })
    )
      setProtectionReason("");
  }
  return (
    <section className="world-panel" aria-label="全局共享世界状态">
      <div className="section-label">
        <div>
          <p className="overline">ONE WORLD / SHARED BY EVERYONE</p>
          <h2>共同的世界</h2>
        </div>
        <span>
          全体玩家共享 · 生效分数 1—19 · {g.activeDisasters.length} 张灾难
        </span>
      </div>
      <div className="world-attributes">
        {dimensions.map(({ key, label }) => {
          const value = g.attributes[key],
            severity =
              value <= 2 || value >= 18
                ? "critical"
                : value <= 6 || value >= 14
                  ? "warning"
                  : "stable";
          return (
            <article className={`world-attribute ${severity}`} key={key}>
              <div className="world-score">
                <h3>{label}</h3>
                <output aria-label={`全局${label}当前值`}>{value}</output>
              </div>
              <label>
                {label}基础值：{draft[key]}
                <input
                  aria-label={`世界${label}滑条`}
                  type="range"
                  min={1}
                  max={19}
                  step={1}
                  value={draft[key]}
                  disabled={locked}
                  onChange={(e) => update(key, Number(e.target.value))}
                />
              </label>
              <div className="world-scale">
                <span>1 · 2 · 6</span>
                <span>7—13 稳定</span>
                <span>14 · 18 · 19</span>
              </div>
              <label className="world-number">
                精确调整
                <input
                  aria-label={`世界${label}数值`}
                  type="number"
                  min={1}
                  max={19}
                  value={draft[key]}
                  disabled={locked}
                  onChange={(e) => update(key, Number(e.target.value))}
                />
              </label>
              <small>
                {g.world.modifiers[key]
                  ? `持续修正 ${g.world.modifiers[key]}（生态管制冲突）；生效分数用于触发灾难`
                  : value <= 2 || value >= 18
                    ? "极端阈值：同向两张灾难叠加"
                    : severity === "warning"
                      ? "偏离稳定区：普通灾难生效"
                      : "当前处于稳定区"}
              </small>
            </article>
          );
        })}
      </div>
      <div className="world-edit">
        <label>
          调节原因
          <input
            aria-label="世界调节原因"
            maxLength={500}
            value={reason}
            disabled={locked}
            placeholder="例如：测试经济极高时的叠加灾难"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button
          className="primary"
          disabled={locked || !dirty || stale || !reason.trim()}
          onClick={() => void save()}
        >
          应用世界分数并结算灾难
        </button>
        <button
          disabled={busy}
          onClick={() => {
            setDirty(false);
            setReason("");
          }}
        >
          恢复当前值
        </button>
      </div>
      <p className="fineprint" role="status">
        {readOnly
          ? "正在只读查看其他玩家；返回当前行动玩家后才能调节世界分数或确认保护条件。"
          : stale
            ? "状态已被其它操作更新，请恢复当前值后重新调整。"
            : g.pending
              ? "请先完成当前卡牌或灾难选择，再手动调分。"
              : "拖动只预览，点击应用后统一结算。极低叠加普通负向；极高叠加普通正向。同档调整不会重复发放或扣除。"}
      </p>
      {g.activeDisasters.some((c) => c.id === "resource-protection") && (
        <div className="protection-confirmation">
          <h3>资源保护 · 条件确认</h3>
          <p>
            先在地图选择资源格，填写实际发生的情况，再确认。不会把普通采集或捐赠自动视为保护。
          </p>
          <label>
            条件说明
            <input
              aria-label="资源保护条件说明"
              value={protectionReason}
              maxLength={500}
              disabled={locked}
              onChange={(e) => setProtectionReason(e.target.value)}
            />
          </label>
          <small>
            当前选择：
            {tile?.resource ? `资源格 ${tile.id}` : "请点击地图上的资源格"}
          </small>
          <div className="two-buttons">
            <button
              disabled={locked || !tile?.resource || !protectionReason.trim()}
              onClick={() => void protect("protected")}
            >
              确认成功保护 · 环境 +1
            </button>
            <button
              disabled={locked || !tile?.resource || !protectionReason.trim()}
              onClick={() => void protect("restricted")}
            >
              确认开发受限 · 经济 −1
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
