"use client";
import { useId, useState, type ReactElement } from "react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import "./card-hint.css";

type Description = {
  name: string;
  effectSummary?: string;
  implementedEffect?: string;
  effect?: string;
  status?: Record<string, number>;
};
export function effectText(card: Description) {
  return (
    card.effectSummary ||
    card.implementedEffect ||
    card.effect ||
    "暂无效果；仅用于展示。"
  );
}
export function worldDelta(card: Description) {
  const labels: Record<string, string> = {
    economy: "经济",
    environment: "环境",
    society: "社会",
  };
  return Object.entries(card.status || {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${labels[k] || k}${v > 0 ? "+" : ""}${v}`)
    .join(" · ");
}
// Use one accessible portaled tooltip for every card surface, including disabled
// choices. The wrapper receives focus without nesting interactive elements.
export function CardHint({
  card,
  children,
  className = "",
}: {
  card: Description;
  children: ReactElement;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        delay={250}
        render={
          <span
            tabIndex={0}
            className={`card-hint-trigger ${className}`}
            aria-label={`${card.name}效果说明`}
            aria-describedby={open ? id : undefined}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent
        id={id}
        role="tooltip"
        aria-hidden={!open}
        side="top"
        className="card-effect-tooltip"
        positionerClassName="z-[200]"
        style={{
          maxWidth: "min(320px, calc(100vw - 24px))",
          display: "block",
          whiteSpace: "normal",
          lineHeight: 1.6,
          padding: "12px 14px",
        }}
      >
        <strong>{card.name} · 本版效果</strong>
        <p>{effectText(card)}</p>
        {worldDelta(card) && (
          <p>生效时共享世界：{worldDelta(card)}；重复被动不叠加。</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
