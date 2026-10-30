"use client";
import type { Game, Player, Resource, Catalog } from "@/lib/expedition";
import { ResourceIcon } from "./resources";
export function DisasterChoice({
  game: g,
  player: p,
  catalog: cat,
  busy,
  act,
}: {
  game: Game;
  player: Player;
  catalog: Catalog;
  busy: boolean;
  act: (type: string, data?: Record<string, unknown>) => Promise<boolean>;
}) {
  const pending = g.pending;
  const resources: Resource[] = ["wood", "metal", "electricity", "seed"];
  if (!pending?.kind.startsWith("disaster_") && pending?.kind !== "eco_block")
    return null;
  const gain = pending.kind === "disaster_gain",
    block = pending.kind === "eco_block";
  return (
    <div className="disaster-choice" aria-label="灾难效果选择">
      <h4>{block ? "生态管制冲突" : pending.cardName}</h4>
      <p>
        {block
          ? `${g.players.find((p) => p.id === pending.owner)?.name} 准备使用降低环境的科技。你可以支付 1 资源使这次科技失效，或放行。`
          : gain
            ? "选择领取一份资源。保障物资也从现有四类资源中选择。"
            : pending.kind === "disaster_aid"
              ? `本轮强制互助：向 ${g.players.find((p) => p.id === pending.targetId)?.name} 转移一份资源。`
              : "选择失去一份现有资源；所有人结算后执行随机移动。"}
      </p>
      <div className="resource-options">
        {resources.map((r) => (
          <button
            key={r}
            aria-label={`${gain ? "领取" : block ? "支付并阻止" : "交出"}${cat.resources[r]}`}
            disabled={busy || (!gain && !p.resources[r])}
            onClick={() =>
              void act("choose", {
                resource: r,
                ...(block ? { block: true } : {}),
              })
            }
          >
            {gain ? "领取" : block ? "支付并阻止" : "交出"}
            <ResourceIcon resource={r} />
          </button>
        ))}
      </div>
      {block && (
        <button
          className="primary"
          disabled={busy}
          onClick={() => void act("choose", { block: false })}
        >
          放行此次科技
        </button>
      )}
      <small>完成后恢复原行动步骤。资源和全局状态变化均会留档。</small>
    </div>
  );
}
