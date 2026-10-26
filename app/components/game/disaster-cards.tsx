"use client";

import { useEffect, useState } from 'react';
import type { Disaster } from '@/lib/api';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import './disaster-cards.css';

const bands: Record<string, string> = {
  criticalLow: '临界低位 · 1—2', low: '低位预警 · 3—6',
  high: '高位预警 · 14—17', criticalHigh: '极端高位 · 18—19',
};

function CardArt({ card, large = false }: { card: Disaster; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!card.image || failed) return <span className="disaster-art-missing">卡图暂不可用，请查看效果说明</span>;
  return <img
    className={large ? 'disaster-art-full' : 'disaster-art'}
    src={`/images/disasters/${card.image.file}`}
    alt={`${card.name}灾难卡`}
    width={card.image.width}
    height={card.image.height}
    onError={() => setFailed(true)}
  />;
}

export function DisasterCards({ cards }: { cards: Disaster[] }) {
  const [selected, setSelected] = useState<Disaster | null>(null);
  useEffect(() => {
    if (selected && !cards.some((card) => card.id === selected.id)) setSelected(null);
  }, [cards, selected]);
  if (!cards.length) return null;
  return <section className="disaster-panel" aria-label="当前灾难卡">
    <div className="disaster-heading"><strong>灾难卡生效中</strong><span>{cards.length} 张 · 世界分数触发</span></div>
    <div className="disaster-cards">
      {cards.map((card) => <article className="disaster-card" key={card.id} data-disaster-id={card.id}>
        {card.image && <button type="button" className="disaster-art-button" aria-label={`查看${card.name}卡牌大图`} onClick={() => setSelected(card)}>
          <CardArt card={card} />
          <span>点击放大 ↗</span>
        </button>}
        <div className="disaster-copy">
          <span className="disaster-band">{card.dimensionLabel} {card.triggerValue} · {bands[card.band] || card.band}</span>
          <h3>{card.name}</h3>
          <p>{card.effect}</p>
        </div>
      </article>)}
    </div>
    <p className="disaster-execution-note">按卡面执行桌面效果；涉及分数的变化请手动调整并留档。</p>
    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
      <DialogContent className="disaster-preview" showCloseButton={false}>
        <div className="disaster-preview-heading">
          <DialogTitle>{selected?.name}</DialogTitle>
          <DialogClose className="disaster-close" aria-label="关闭卡牌大图">关闭 ×</DialogClose>
        </div>
        <DialogDescription>文档原卡 · 保持原图比例，可滚动查看完整卡面。</DialogDescription>
        {selected && <><CardArt key={selected.id} card={selected} large /><p className="disaster-full-effect">{selected.effect}</p></>}
      </DialogContent>
    </Dialog>
  </section>;
}
