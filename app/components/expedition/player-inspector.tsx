"use client";
import type { Bag, Catalog, Player, Resource } from "@/lib/expedition";
import { ResourceIcon } from "./resources";
import { CardHint } from "../game/card-hint";

type Props = {
  player: Player;
  catalog: Catalog;
  onPreview: (art: { name: string; image: string }) => void;
};
const resources: Resource[] = ["wood", "metal", "electricity", "seed"];

// Intentionally accepts no action callback: inspection can only open artwork.
export function PlayerInspector({ player, catalog, onPreview }: Props) {
  const character = catalog.characters.find((c) => c.id === player.characterId);
  const cards = [...catalog.cards.actions, ...catalog.cards.technology];
  function inventory(title: string, value: Bag) {
    return (
      <div className="inspection-inventory">
        <h3>{title}</h3>
        <dl>
          {resources.map((resource) => (
            <div key={resource}>
              <dt>
                <ResourceIcon resource={resource} />
              </dt>
              <dd>{value[resource]}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }
  function artwork(id: string, key: string) {
    const card = cards.find((c) => c.id === id);
    return card ? (
      <div key={key} className="inspection-card">
        <CardHint card={card}>
          <button
            className="art-button"
            aria-label={`查看${card.name}卡面`}
            onClick={() => onPreview(card)}
          >
            <img src={card.image} alt={card.name} />
          </button>
        </CardHint>
        <strong>{card.name}</strong>
        <p>{card.implementedEffect || card.effect}</p>
      </div>
    ) : (
      <p key={key}>未知卡牌：{id}</p>
    );
  }
  return (
    <section
      className="player-inspector"
      aria-label={`${player.id} 玩家只读详情`}
    >
      <p className="overline">{player.id} / 只读查看</p>
      <div className="inspection-identity">
        {character && (
          <CardHint card={character}>
            <button
              className="art-button"
              aria-label="查看角色卡面"
              onClick={() => onPreview(character)}
            >
              <img src={character.image} alt={character.name} />
            </button>
          </CardHint>
        )}
        <div>
          <h2>{player.name}</h2>
          <p>
            {character?.name} · {character?.factionLabel}
          </p>
          <p>
            出生 {player.spawn} · 当前格 {player.position}
          </p>
        </div>
      </div>
      <p className="inspection-note">
        可查看卡面和详细信息，不会改变当前行动玩家或推进回合。
      </p>
      {inventory("持有资源", player.resources)}
      {inventory("累计捐赠", player.donated)}
      <p className="inspection-note">
        伤势 {player.survivalPreview.injury}；种子救生后{" "}
        {player.survivalPreview.remainingInjury} / 耐受{" "}
        {player.survivalPreview.tolerance}。生存资格以终局统一结算为准。
      </p>
      <div className="hand-heading">
        <h3>手牌</h3>
        <small>
          {player.hand.length} / {player.handLimit}
        </small>
      </div>
      <div className="inspection-cards">
        {player.hand.map((c) => artwork(c.id, c.uid))}
        {!player.hand.length && <p>暂无手牌</p>}
      </div>
      <h3>已生效科技</h3>
      <div className="inspection-cards">
        {player.equipment.map((id) => artwork(id, id))}
        {!player.equipment.length && <p>暂无已生效科技</p>}
      </div>
      <div className="inspection-impact">
        <h3>对共享世界的累计影响</h3>
        <p>
          经济 {player.worldImpact.economy} · 环境{" "}
          {player.worldImpact.environment} · 社会 {player.worldImpact.society}
        </p>
        <small>这是该玩家行动的累计影响，不是个人世界分数。</small>
      </div>
    </section>
  );
}
