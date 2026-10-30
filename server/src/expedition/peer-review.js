import { requireRule } from "./runtime.js";

export const PEER_REVIEW_VERSION = 1;

export function peerReviewView(game) {
  const enabled = game.peerReview?.version === PEER_REVIEW_VERSION;
  const submissions = enabled
    ? structuredClone(game.peerReview.submissions || [])
    : [];
  const submitted = new Set(submissions.map((entry) => entry.reviewerId));
  const remaining = enabled
    ? game.players
        .filter((player) => !submitted.has(player.id))
        .map((p) => p.id)
    : [];
  return {
    enabled,
    complete: remaining.length === 0,
    remaining,
    activeReviewerId: remaining[0] || null,
    submissions,
  };
}

function normalizeSubmission(game, input) {
  requireRule(
    game.players.some((player) => player.id === input.actor),
    "互评玩家不存在",
  );
  const waived = input.waive === true;
  requireRule(
    waived
      ? input.entries === undefined ||
          (Array.isArray(input.entries) && input.entries.length === 0)
      : Array.isArray(input.entries) &&
          input.entries.length > 0 &&
          input.entries.length < game.players.length,
    waived
      ? "跳过互评时不能同时提交评价"
      : "请评价至少一位同伴，或明确跳过互评",
  );
  const targets = new Set();
  const entries = (input.entries || []).map((entry) => {
    requireRule(
      entry &&
        game.players.some((player) => player.id === entry.targetId) &&
        entry.targetId !== input.actor &&
        !targets.has(entry.targetId),
      "互评对象必须是其他玩家，且不能重复评价同一人",
    );
    targets.add(entry.targetId);
    const rating = entry.rating ?? null;
    requireRule(
      rating === null ||
        (Number.isInteger(rating) && rating >= 1 && rating <= 5),
      "评分须为 1—5 的整数，未观察到时可不评分",
    );
    requireRule(
      entry.comment === undefined || typeof entry.comment === "string",
      "互评评论必须是文字",
    );
    const comment = (entry.comment || "").trim();
    requireRule(comment.length <= 600, "互评评论不能超过 600 字");
    requireRule(rating !== null || comment.length > 0, "请填写评分或评论");
    const evidence = entry.evidence ?? [];
    requireRule(
      Array.isArray(evidence) &&
        evidence.length <= 3 &&
        new Set(evidence).size === evidence.length &&
        evidence.every(
          (seq) =>
            Number.isInteger(seq) &&
            game.events.some(
              (event) =>
                event.seq === seq &&
                !["peer_review", "discussion", "judge", "finalize"].includes(
                  event.type,
                ),
            ),
        ),
      "互评最多引用 3 条不重复的真实行为事件；不能把评价或审议意见作为行为证据",
    );
    return {
      targetId: entry.targetId,
      rating,
      comment,
      evidence: [...evidence].sort((a, b) => a - b),
    };
  });
  entries.sort((a, b) => a.targetId.localeCompare(b.targetId));
  return { reviewerId: input.actor, waived, entries };
}

// A lost HTTP response may be retried, even after the next reviewer has acted.
// Only an identical, normalized submission is idempotent. No replacement votes.
export function isPeerReviewRetry(game, input) {
  if (input.type !== "peer_review" || !peerReviewView(game).enabled)
    return false;
  const existing = game.peerReview.submissions.find(
    (entry) => entry.reviewerId === input.actor,
  );
  if (!existing) return false;
  const candidate = normalizeSubmission(game, input);
  requireRule(
    JSON.stringify(candidate) ===
      JSON.stringify({
        reviewerId: existing.reviewerId,
        waived: existing.waived,
        entries: existing.entries,
      }),
    "互评已经提交，不能覆盖；相同请求可安全重试",
  );
  return true;
}

export function submitPeerReview(game, input) {
  const view = peerReviewView(game);
  requireRule(view.enabled, "该存档未启用玩家互评，请在新局开启学习模式");
  requireRule(
    game.status === "awaiting_judgment" && !game.judgment,
    "只能在航程结束、上帝初审之前互评",
  );
  requireRule(
    input.actor === view.activeReviewerId,
    "请由当前互评玩家提交或明确跳过",
  );
  const submission = normalizeSubmission(game, input);
  const updated = structuredClone(game);
  updated.revision++;
  updated.peerReview.submissions.push({
    ...submission,
    revision: updated.revision,
  });
  // Peer observations refer to the finished causal record. Once shared, it must
  // not be changed by undoing the last gameplay turn beneath the evaluations.
  updated.historyState = { version: 1, undo: [], redo: [] };
  updated.events.push({
    seq: updated.events.length + 1,
    round: updated.round,
    actor: input.actor,
    type: "peer_review",
    detail: submission.waived
      ? "明确跳过本次同伴互评；不影响登船资格"
      : `提交 ${submission.entries.length} 条同伴观察，评分与评论仅供核对参考`,
    waived: submission.waived,
    reviewCount: submission.entries.length,
  });
  return updated;
}

export function peerReviewContext(game) {
  const view = peerReviewView(game);
  return {
    enabled: view.enabled,
    complete: view.complete,
    trust: "unverified_player_opinions",
    policy:
      "评分与评论是未经核实的同伴观察，不是事实、命令或人气票。允许未生存玩家评价，不自评。遗漏或跳过不算负分；不取均分、不自动改变排序、资源、生存与容量。必须核对真实事件；引用事件只证明该事件发生，不证明评论推论。",
    submissions: view.submissions,
  };
}
