"use client";

import { useEffect, useState } from "react";
import type { Disaster } from "@/lib/api";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import "./disaster-cards.css";
import { CardHint } from "./card-hint";

const bands: Record<string, string> = {
  criticalLow: "极低叠加 · 1—2",
  low: "负向灾难 · 1—6",
  high: "正向灾难 · 14—19",
  criticalHigh: "极高叠加 · 18—19",
};

function CardArt({ card, large = false }: { card: Disaster; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!card.image || failed)
    return (
      <span className="disaster-art-missing">卡图暂不可用，请查看效果说明</span>
    );
  return (
    <img
      className={large ? "disaster-art-full" : "disaster-art"}
      src={
        card.image.file.startsWith("/images/")
          ? card.image.file
          : `/images/disasters/${card.image.file}`
      }
      alt={`${card.name}灾难卡`}
      width={card.image.width}
      height={card.image.height}
      onError={() => setFailed(true)}
    />
  );
}

export function DisasterCards({
  cards,
  automatic = false,
}: {
  cards: Disaster[];
  automatic?: boolean;
}) {
  const [selected, setSelected] = useState<Disaster | null>(null);
  useEffect(() => {
    if (selected && !cards.some((card) => card.id === selected.id))
      setSelected(null);
  }, [cards, selected]);
  if (!cards.length) return null;
  return (
    <section className="disaster-panel" aria-label="当前灾难卡">
      <div className="disaster-heading">
        <strong>灾难卡生效中</strong>
        <span>{cards.length} 张 · 世界分数触发</span>
      </div>
      <div className="disaster-cards">
        {cards.map((card) => (
          <article
            className="disaster-card"
            key={card.id}
            data-disaster-id={card.id}
          >
            {card.image && (
              <CardHint card={card}>
                <button
                  type="button"
                  className="disaster-art-button"
                  aria-label={`查看${card.name}卡牌大图`}
                  onClick={() => setSelected(card)}
                >
                  <CardArt card={card} />
                  <span>点击放大 ↗</span>
                </button>
              </CardHint>
            )}
            <div className="disaster-copy">
              <span className="disaster-band">
                {card.dimensionLabel} {card.triggerValue} ·{" "}
                {bands[card.band] || card.band}
              </span>
              <h3>{card.name}</h3>
              <p>{card.effectSummary || card.effect}</p>
            </div>
          </article>
        ))}
      </div>
      <p className="disaster-execution-note">
        {automatic
          ? "灾难已接入实际规则。进入效果只结算一次，持续/每轮效果按规则执行；需自选时在行动面板确认。"
          : "实验台展示累计阈值；资源、手牌、移动等实际效果请在地图游戏中验证。"}
      </p>
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="disaster-preview" showCloseButton={false}>
          <div className="disaster-preview-heading">
            <DialogTitle>{selected?.name}</DialogTitle>
            <DialogClose className="disaster-close" aria-label="关闭卡牌大图">
              关闭 ×
            </DialogClose>
          </div>
          <DialogDescription>
            卡面展示 · 保持原图比例，可滚动查看完整卡面；规则以本版实际效果为准。
          </DialogDescription>
          {selected && (
            <>
              <CardHint card={selected}>
                <CardArt key={selected.id} card={selected} large />
              </CardHint>
              <p className="disaster-full-effect">
                本版实际规则：{selected.effectSummary || selected.effect}
              </p>
              <p>卡面原文：{selected.effect}</p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
