"use client";
import { useEffect, useState } from "react";
import type { Game, PeerReviewEntry } from "@/lib/expedition";
import "./learning-panels.css";

export function PeerReviewPanel({
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
  const summary = g.peerReviewSummary;
  const actor = summary?.activeReviewerId;
  const [draft, setDraft] = useState<
    Record<string, { rating: string; comment: string; evidence: string }>
  >({});
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft({});
    setError("");
  }, [g.id, actor]);
  if (!summary?.enabled) return null;
  const update = (id: string, field: string, value: string) =>
    setDraft((old) => ({
      ...old,
      [id]: {
        ...(old[id] || { rating: "", comment: "", evidence: "" }),
        [field]: value,
      },
    }));
  async function submit() {
    setError("");
    const entries: PeerReviewEntry[] = [];
    for (const [targetId, value] of Object.entries(draft)) {
      if (!value.rating && !value.comment.trim() && !value.evidence.trim())
        continue;
      if (!value.rating && !value.comment.trim()) {
        setError("请为引用的事件补充一句评论，或选择评分。");
        return;
      }
      const tokens = value.evidence.trim()
        ? value.evidence.trim().split(/[\s,，、]+/)
        : [];
      if (tokens.length > 3 || tokens.some((t) => !/^#?\d+$/.test(t))) {
        setError("事件编号最多三个，例如 18, 25；也可以留空。");
        return;
      }
      const evidence = tokens.map((t) => Number(t.replace(/^#/, "")));
      if (evidence.some((seq) => !g.events.some((e) => e.seq === seq))) {
        setError("有事件编号不存在，请在航程记录中核对。");
        return;
      }
      entries.push({
        targetId,
        rating: value.rating ? Number(value.rating) : null,
        comment: value.comment.trim(),
        evidence,
      });
    }
    if (!entries.length) {
      setError("至少评价一位观察到的伙伴，或明确跳过本次互评。");
      return;
    }
    await act("peer_review", { entries });
  }
  return (
    <section className="peer-review-panel" aria-label="玩家互评">
      <p className="overline">CREW REFLECTION / 先听伙伴，再听上帝</p>
      <h3>
        {summary.complete
          ? "全员互评已完成"
          : `轮到 ${actor} 互评 · 剩余 ${summary.remaining.length} 人`}
      </h3>
      <p>
        只评价你观察到的合作行为。评分是主观意见，不兑换席位；未存活的玩家也有表达权。
      </p>
      {!summary.complete &&
        (readOnly ? (
          <button onClick={onReturn}>返回当前互评玩家</button>
        ) : (
          <>
            <p className="fineprint">
              评分参考：1 很少合作 · 3 有贡献也有代价 · 5
              持续帮助。未观察到就留空，不必逐人打分。首次提交或跳过后锁定航程撤回。
            </p>
            <div className="peer-review-grid">
              {g.players
                .filter((p) => p.id !== actor)
                .map((p) => (
                  <fieldset key={p.id} disabled={busy}>
                    <legend>
                      {p.id} · {p.name}
                    </legend>
                    <label>
                      合作表现
                      <select
                        aria-label={`${p.id} 合作评分`}
                        value={draft[p.id]?.rating || ""}
                        onChange={(e) => update(p.id, "rating", e.target.value)}
                      >
                        <option value="">未观察到 / 不评分</option>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n} 分
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      观察与理由（可单独评论）
                      <textarea
                        aria-label={`${p.id} 互评评论`}
                        maxLength={600}
                        rows={2}
                        value={draft[p.id]?.comment || ""}
                        onChange={(e) =>
                          update(p.id, "comment", e.target.value)
                        }
                        placeholder="例如：他保留种子自救，也两次帮助我。"
                      />
                    </label>
                    <label>
                      事件编号（选填，最多三个）
                      <input
                        aria-label={`${p.id} 互评事件`}
                        value={draft[p.id]?.evidence || ""}
                        onChange={(e) =>
                          update(p.id, "evidence", e.target.value)
                        }
                        placeholder="例如 18, 25"
                      />
                    </label>
                  </fieldset>
                ))}
            </div>
            {error && <p role="alert">{error}</p>}
            <div className="two-buttons">
              <button
                className="primary"
                disabled={busy}
                onClick={() => void submit()}
              >
                提交我的互评
              </button>
              <button
                disabled={busy}
                onClick={() => void act("peer_review", { waive: true })}
              >
                未观察到，跳过互评
              </button>
            </div>
          </>
        ))}
      {summary.complete && (
        <details>
          <summary>查看互评记录（意见，不是事实认定）</summary>
          {summary.submissions.map((s) => (
            <article key={s.reviewerId} className="peer-review-record">
              <strong>
                {s.reviewerId}
                {s.waived ? " · 明确跳过" : " 的观察"}
              </strong>
              {s.entries.map((e) => (
                <p key={e.targetId}>
                  {e.targetId} ·{" "}
                  {e.rating === null ? "未评分" : `${e.rating}/5`}：
                  {e.comment || "仅评分，未提供文字理由"}
                  {e.evidence.length > 0 && (
                    <small>
                      {" "}
                      事件 {e.evidence.map((n) => `#${n}`).join("、")}
                    </small>
                  )}
                </p>
              ))}
            </article>
          ))}
        </details>
      )}
    </section>
  );
}

export function LearningOutcomePanel({ game: g }: { game: Game }) {
  const outcome = g.learningOutcome;
  if (!outcome || !g.learningMode) return null;
  return (
    <section className="learning-outcome" aria-label="多层航程成果">
      <p className="overline">VOYAGE DEBRIEF / 胜负不止一张船票</p>
      <h3>{outcome.title}</h3>
      <div className="learning-goals">
        {outcome.goals.map((goal) => (
          <article key={goal.id} data-achieved={String(goal.achieved)}>
            <strong>
              {goal.achieved === null
                ? "待讨论"
                : goal.achieved
                  ? "达成"
                  : "仍有挑战"}{" "}
              · {goal.title}
            </strong>
            <p>{goal.detail}</p>
          </article>
        ))}
      </div>
      <p className="fineprint">{outcome.disclaimer}</p>
      <details>
        <summary>每位伙伴留下了什么？</summary>
        <div className="learning-goals">
          {outcome.personal.map((p) => (
            <article key={p.playerId}>
              <strong>
                {p.playerId} ·{" "}
                {g.players.find((v) => v.id === p.playerId)?.name}
              </strong>
              <p>
                实际捐赠 {p.donatedUnits} 份 · 参与合作 {p.cooperationCount} 次
                · 修复行动 {p.repairActions} 次
              </p>
              <p>
                {p.repairedAfterHarm
                  ? "记录中出现了造成影响后的修复尝试。"
                  : "可以继续讨论：哪一次选择还存在更好的方案？"}
              </p>
              <small>
                {p.boarded === null
                  ? "席位尚未定案"
                  : p.boarded
                    ? "最终获得席位"
                    : "未获席位不代表没有价值"}
                。这些是行为记录，不是人格或学习成绩。
              </small>
            </article>
          ))}
        </div>
      </details>
      {g.opportunityContext && (
        <details className="opportunity-context">
          <summary>出生条件如何影响机会？</summary>
          <p className="fineprint">{g.opportunityContext.basis}</p>
          <div className="opportunity-scroll">
            <table>
              <caption>创建本局时的地图条件，不是玩家能力评分</caption>
              <thead>
                <tr>
                  <th>玩家 / 旗点</th>
                  <th>到安全区最少步数</th>
                  <th>两步内资源格</th>
                </tr>
              </thead>
              <tbody>
                {g.opportunityContext.players.map((p) => (
                  <tr key={p.playerId}>
                    <th scope="row">
                      {p.playerId} / {p.flagId}
                    </th>
                    <td>
                      {p.available
                        ? (p.minimumStepsToSafeZone ?? "无可达路径")
                        : "无数据"}
                    </td>
                    <td>
                      {p.available ? p.resourceTilesWithinTwoSteps : "无数据"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fineprint">{g.opportunityContext.limitations}</p>
        </details>
      )}
    </section>
  );
}

export function LearningSpotlight({ game: g }: { game: Game }) {
  const j = g.judgment;
  if (!g.learningMode || !j?.rag?.evidence?.length) return null;
  const reading = j.verdict.learning?.[0];
  const source =
    j.rag.evidence.find((s: { id: string }) => s.id === reading?.sourceId) ||
    j.rag.evidence[0];
  const event =
    g.events.find((e) => e.seq === reading?.eventSeqs?.[0]) ||
    [...g.events]
      .reverse()
      .find((e) => ["world_change", "donation", "technology"].includes(e.type));
  return (
    <aside className="learning-spotlight" aria-label="一分钟反思">
      <p className="overline">ONE IDEA / 一个概念，重新看一次选择</p>
      <h3>{source.concepts?.[0] || source.title}</h3>
      <p>{source.content}</p>
      {event && (
        <p>
          <strong>回看本局 #{event.seq}：</strong>
          {event.detail}
        </p>
      )}
      <p>
        <strong>想一想：</strong>
        如果重来，你会如何兼顾眼前收益与他人的处境？这个概念有哪些前提在本局并不成立？
      </p>
      <small>
        {j.llm.used
          ? "模型引用仍可质疑；完整出处与局限可在下方展开。"
          : "这是阅读与反思提示，并非模型已经理解你的理由。"}{" "}
        游戏里的因果是简化规则，不是现实定律。
      </small>
    </aside>
  );
}
