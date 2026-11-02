"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Catalog } from "@/lib/expedition";
import type { Disaster } from "@/lib/disasters";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CardHint, worldDelta } from "../game/card-hint";
import "./card-catalog.css";

type Category = "all" | "action" | "technology" | "disaster";
type Entry = {
  id: string;
  category: Exclude<Category, "all">;
  name: string;
  type: string;
  image: string;
  effect: string;
  effectSummary: string;
  status?: Record<string, number>;
  trigger?: string;
};
const categories: { id: Category; label: string }[] = [
  { id: "all", label: "全部卡牌" },
  { id: "action", label: "手牌种类" },
  { id: "technology", label: "科技牌" },
  { id: "disaster", label: "灾难牌" },
];
const bands: Record<string, string> = {
  criticalLow: "极低叠加 · 1–2",
  low: "负向灾难 · 1–6",
  high: "正向灾难 · 14–19",
  criticalHigh: "极高叠加 · 18–19",
};

function CatalogArt({ entry }: { entry: Entry }) {
  const [failed, setFailed] = useState(false);
  if (!entry.image || failed)
    return (
      <span className="catalog-image-missing">
        卡面暂不可用，请查看下方规则
      </span>
    );
  return (
    <img
      src={entry.image}
      alt={`${entry.name}卡面`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/** Read-only catalogue: no game state, action callbacks or mutation requests. */
export function CardCatalog({
  catalog,
  disasters,
  learningMode,
}: {
  catalog: Catalog;
  disasters: Disaster[];
  learningMode: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const entries = useMemo<Entry[]>(() => {
    const cards = [
      ...catalog.cards.actions.map((card) => ({
        card,
        category: "action" as const,
      })),
      ...catalog.cards.technology.map((card) => ({
        card,
        category: "technology" as const,
      })),
    ].map(({ card, category }) => ({
      id: `${category}:${card.id}`,
      category,
      name: card.name,
      type: card.type,
      image: (learningMode && card.learningImage) || card.image,
      effect:
        (learningMode && card.learningEffect) ||
        card.implementedEffect ||
        card.effect,
      effectSummary:
        (learningMode && card.learningSummary) ||
        card.effectSummary ||
        card.implementedEffect ||
        card.effect,
      status: (learningMode && card.learningStatus) || card.status,
    }));
    return [
      ...cards,
      ...disasters.map((card) => {
        const art = (learningMode && card.learningImage) || card.image;
        return {
          id: `disaster:${card.id}`,
          category: "disaster" as const,
          name: card.name,
          type: `${card.dimensionLabel}灾难`,
          image: art
            ? art.file.startsWith("/images/")
              ? art.file
              : `/images/disasters/${art.file}`
            : "",
          effect:
            (learningMode && card.learningEffect) ||
            card.effectSummary ||
            card.effect,
          effectSummary:
            (learningMode && card.learningSummary) ||
            card.effectSummary ||
            card.effect,
          trigger: `${card.dimensionLabel} · ${bands[card.band] || card.band}`,
        };
      }),
    ];
  }, [catalog, disasters, learningMode]);
  const selected = entries.find((entry) => entry.id === selectedId);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = entries.filter(
    (entry) =>
      (category === "all" || entry.category === category) &&
      `${entry.name} ${entry.effectSummary} ${entry.effect} ${entry.trigger || ""}`
        .toLocaleLowerCase()
        .includes(normalizedQuery),
  );
  useEffect(() => {
    if (selectedId) heading.current?.focus();
  }, [selectedId]);

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setSelectedId(null);
      }}
    >
      <DialogTrigger className="catalog-open" data-testid="card-catalog-open">
        <span aria-hidden="true">▤</span> 卡牌图鉴{" "}
        <small>{entries.length} 种 · 只读预览</small>
      </DialogTrigger>
      <DialogContent className="card-catalog-dialog" showCloseButton={false}>
        <header className="catalog-heading">
          <div>
            <span className="catalog-eyebrow">THE VOYAGER’S FIELD GUIDE</span>
            <DialogTitle>卡牌图鉴</DialogTitle>
          </div>
          <DialogClose className="catalog-close" aria-label="关闭卡牌图鉴">
            关闭 ×
          </DialogClose>
        </header>
        <DialogDescription className="catalog-intro">
          {learningMode ? "学习版规则" : "当前旧版存档规则"} ·
          预览不会抽牌、出牌或触发灾难。悬停或键盘聚焦看简述，点击卡片看大图与完整效果。
        </DialogDescription>
        {selected ? (
          <div
            className="catalog-detail"
            data-rule-version={learningMode ? "learning" : "legacy"}
          >
            <button
              className="catalog-back"
              onClick={() => setSelectedId(null)}
              type="button"
            >
              ← 返回全部预览
            </button>
            <div className="catalog-detail-layout">
              <div className="catalog-detail-art">
                <CatalogArt key={selected.id} entry={selected} />
              </div>
              <section
                className="catalog-detail-copy"
                aria-label={`${selected.name}完整效果`}
              >
                <span className="catalog-card-kind">{selected.type}</span>
                <h3 tabIndex={-1} ref={heading}>
                  {selected.name}
                </h3>
                {selected.trigger && (
                  <strong className="catalog-trigger">
                    触发范围：{selected.trigger}
                  </strong>
                )}
                <p className="catalog-summary">{selected.effectSummary}</p>
                <h4>本版完整规则</h4>
                <p>{selected.effect}</p>
                {worldDelta(selected) && (
                  <p className="catalog-world-effect">
                    生效时共享世界：{worldDelta(selected)}。重复被动不叠加。
                  </p>
                )}
                {selected.category === "disaster" && (
                  <p className="catalog-rule-note">
                    极端分数会叠加：1–2 同时触发负向与极低灾难，18–19
                    同时触发正向与极高灾难；不是二选一。
                  </p>
                )}
                <p className="catalog-rule-note">
                  效果以本版规则为准；部分原卡面保留设计原文。此处不能使用卡牌。
                </p>
              </section>
            </div>
          </div>
        ) : (
          <>
            <div className="catalog-filters" role="group" aria-label="卡牌分类">
              {categories.map(({ id, label }) => (
                <button
                  type="button"
                  key={id}
                  aria-pressed={category === id}
                  onClick={() => setCategory(id)}
                >
                  {label}{" "}
                  <span>
                    {id === "all"
                      ? entries.length
                      : entries.filter((entry) => entry.category === id).length}
                  </span>
                </button>
              ))}
            </div>
            <label className="catalog-search">
              <span>查找卡牌或效果</span>
              <input
                type="search"
                value={query}
                placeholder="例如：采矿、种子、环境"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="catalog-results-summary" aria-live="polite">
              <span>
                显示 {visible.length} / {entries.length} 种
              </span>
              <span>
                {category === "disaster"
                  ? "极端值同时叠加普通与极端灾难"
                  : "手牌/科技按种类等概率、有放回抽取；种类数不等于牌堆张数"}
              </span>
            </div>
            <div className="catalog-grid" aria-label="卡牌预览列表">
              {visible.map((entry) => (
                <article
                  className="catalog-entry"
                  key={entry.id}
                  data-card-id={entry.id}
                >
                  <CardHint card={entry}>
                    <button
                      type="button"
                      className="catalog-card-button"
                      aria-label={`预览${entry.name}`}
                      onClick={() => setSelectedId(entry.id)}
                    >
                      <div className="catalog-art-frame">
                        <CatalogArt entry={entry} />
                      </div>
                      <div className="catalog-card-copy">
                        <span className="catalog-card-kind">{entry.type}</span>
                        <h3>{entry.name}</h3>
                        {entry.trigger && (
                          <span className="catalog-trigger">
                            {entry.trigger}
                          </span>
                        )}
                        <p>{entry.effectSummary}</p>
                        <span className="catalog-view-link">
                          完整效果与大图 ↗
                        </span>
                      </div>
                    </button>
                  </CardHint>
                </article>
              ))}
            </div>
            {!visible.length && (
              <p className="catalog-empty">
                没有找到对应卡牌。试试名称或资源关键词。
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
