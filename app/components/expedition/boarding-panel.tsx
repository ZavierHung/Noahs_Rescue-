"use client";
import { useEffect, useState } from "react";
import type { Game } from "@/lib/expedition";
import { AcademicEvidence } from "./knowledge-panel";
import {
  PeerReviewPanel,
  LearningOutcomePanel,
  LearningSpotlight,
} from "./learning-panels";
export function BoardingPanel({
  game: g,
  busy,
  readOnly,
  onReturn,
  act,
}: {
  game: Game;
  busy: boolean;
  readOnly: boolean;
  onReturn: () => void;
  act: (type: string, data?: Record<string, unknown>) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  useEffect(() => setText(""), [g.activePlayerId, g.id]);
  const j = g.judgment,
    remaining = g.reviewRemaining || [],
    actor = g.players.find((p) => p.id === g.activePlayerId)!;
  return (
    <section className="action-panel boarding-panel" aria-label="登船审议">
      <p className="overline">
        BOARDING COUNCIL /{" "}
        {g.status === "finished"
          ? "最终名单"
          : j
            ? "逐人交互 · 尚未定案"
            : "初步评议"}
      </p>
      <h2>谁能登上方舟？</h2>
      <div className="interaction-ready">
        最终库存 {g.capacity.units} 份 ÷ 每席 {g.capacity.unitsPerSeat}{" "}
        份，当前容量 <strong>{g.capacity.seats} 人</strong>（上限{" "}
        {g.capacity.maxSeats} 人）。幸存{" "}
        {g.players.filter((p) => p.survivalPreview.alive).length} /{" "}
        {g.players.length} 人。
      </div>
      <p>上帝只从幸存者中决定名单，不触发灾难或奖惩，也不能增加容量。</p>
      <LearningOutcomePanel game={g} />
      <PeerReviewPanel
        game={g}
        busy={busy}
        readOnly={readOnly}
        onReturn={onReturn}
        act={act}
      />
      <details>
        <summary>查看生存结算</summary>
        {g.players.map((p) => (
          <p key={p.id}>
            <strong>
              {p.id} · {p.name}：{p.survivalPreview.alive ? "幸存" : "未存活"}
            </strong>
            <br />
            {p.survivalPreview.reason} 伤势 {p.survivalPreview.injury}，救生种子{" "}
            {p.survivalPreview.seedsUsed}，剩余伤势{" "}
            {p.survivalPreview.remainingInjury} / 耐受{" "}
            {p.survivalPreview.tolerance}。
          </p>
        ))}
      </details>
      {!j ? (
        <>
          <p className="fineprint">
            开始审议将锁定航程证据，不能再撤回或重做。若需修正最后的行动，请先使用上方「行动修正」。
          </p>
          <button
            className="primary"
            disabled={
              busy ||
              readOnly ||
              (g.peerReviewSummary?.enabled === true &&
                !g.peerReviewSummary.complete)
            }
            onClick={() => void act("judge")}
          >
            {busy ? "上帝正在查阅全局记录…" : "请上帝审判这段航程"}
          </button>
          {g.peerReviewSummary?.enabled && !g.peerReviewSummary.complete && (
            <p className="fineprint">
              先让每位伙伴提交或跳过互评，再请上帝综合记录给出初判。
            </p>
          )}
        </>
      ) : (
        <>
          <h3>{j.god.name}</h3>
          <span className="local-chip">
            {j.llm.used ? "M3 模型审议" : "本地规则审议（未使用 LLM）"}
          </span>
          <p>{j.verdict.statement}</p>
          <LearningSpotlight game={g} />
          <details className="academic-current">
            <summary>本阶段学术依据与行为分析</summary>
            <AcademicEvidence
              rag={j.rag}
              learning={j.verdict.learning}
              used={j.llm.used}
            />
          </details>
          {j.verdict.decisions.map((d: any) => (
            <article
              className={`boarding-decision ${d.board ? "admitted" : ""}`}
              key={d.playerId}
            >
              <strong>
                {g.status !== "finished" ? "暂定 · " : ""}
                {d.board ? "准予登舟" : "未获席位"} ·{" "}
                {g.players.find((p) => p.id === d.playerId)?.name}
              </strong>
              <p>{d.reason}</p>
              <small>
                依据事件：{d.evidence.map((n: number) => `#${n}`).join("、")}
              </small>
            </article>
          ))}
          {g.status === "review" && (
            <>
              <h3>幸存者发言 · 剩余 {remaining.length} 人</h3>
              {remaining.length > 0 &&
                (readOnly ? (
                  <button onClick={onReturn}>返回当前发言玩家</button>
                ) : (
                  <div className="council-response">
                    <p>
                      <strong>
                        {actor.id} · {actor.name}
                      </strong>
                      ，现在轮到你。
                    </p>
                    <p>
                      {
                        j.questions?.find((q: any) => q.playerId === actor.id)
                          ?.text
                      }
                    </p>
                    <label>
                      登船陈述 / 申辩
                      <textarea
                        aria-label="玩家登船陈述"
                        maxLength={4000}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        disabled={busy}
                      />
                    </label>
                    <div className="two-buttons">
                      <button
                        disabled={busy || !text.trim()}
                        onClick={() => void act("discuss", { text })}
                      >
                        提交发言并听取回应
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void act("discuss", { waive: true })}
                      >
                        该玩家放弃发言
                      </button>
                    </div>
                  </div>
                ))}
              <button
                className="primary"
                disabled={busy || readOnly || remaining.length > 0}
                onClick={() => void act("finalize")}
              >
                {busy ? "正在审议…" : "完成交互，请上帝敲定最终名单"}
              </button>
            </>
          )}
          <details
            className="judgment-history"
            open={g.status === "review" && !!j.conversations?.length}
          >
            <summary>初判与逐人交互留档</summary>
            {j.conversations?.map((c: any, i: number) => (
              <div key={i}>
                <h4>
                  {c.playerId} · {c.waived ? "放弃发言" : "登船陈述"}
                </h4>
                <p>{c.text}</p>
                <p>上帝回应：{c.reply}</p>
              </div>
            ))}
            {j.history?.map((h: any, i: number) => (
              <details key={i}>
                <summary>
                  {h.stage === "initial"
                    ? "初步名单"
                    : h.stage === "final"
                      ? "最终名单"
                      : `${h.playerId} 讨论后的暂定名单`}
                </summary>
                <p>{h.verdict.statement}</p>
                <AcademicEvidence
                  rag={h.rag}
                  learning={h.verdict.learning}
                  used={h.llm.used}
                />
                {h.verdict.decisions.map((d: any) => (
                  <p key={d.playerId}>
                    {d.playerId} · {d.board ? "允许登舟" : "未获席位"}：
                    {d.reason}
                  </p>
                ))}
              </details>
            ))}
          </details>
          <details>
            <summary>本地 RAG 证据与流程</summary>
            <p>{j.trace.join(" → ")}</p>
            {j.rag.evidence.map((e: any) => (
              <p key={e.id}>
                <strong>{e.title}</strong>
                <br />
                {e.content}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
