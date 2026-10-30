export function validateLearning(
  learning,
  evidence,
  context,
  { required = false, stage = "initial" } = {},
) {
  if (learning === undefined && !required) return undefined;
  if (
    !Array.isArray(learning) ||
    learning.length > evidence.length ||
    (required && learning.length < (stage === "discussion" ? 2 : 3))
  )
    throw new Error("invalid_academic_citations");
  const seen = new Set();
  const sanitized = learning.map((item) => {
    const source = evidence.find((s) => s.id === item.sourceId);
    if (
      !source ||
      seen.has(item.sourceId) ||
      typeof item.application !== "string" ||
      !item.application.trim() ||
      !Array.isArray(item.eventSeqs) ||
      !item.eventSeqs.length ||
      item.eventSeqs.some(
        (seq) => !context.globalEvents.some((e) => e.seq === seq),
      )
    )
      throw new Error("ungrounded_academic_citation");
    seen.add(item.sourceId);
    return {
      sourceId: source.id,
      application: item.application.slice(0, 1600),
      eventSeqs: [...new Set(item.eventSeqs)],
    };
  });
  if (
    required &&
    stage !== "discussion" &&
    new Set(
      sanitized.map((l) => evidence.find((s) => s.id === l.sourceId).domain),
    ).size !== 3
  )
    throw new Error("missing_academic_domain");
  return sanitized;
}

export function localLearning(evidence, context) {
  // This is a reading guide, not a claim that a rule-based fallback reasons with literature.
  return evidence.map((source) => {
    const kinds =
      source.domain === "economy"
        ? ["donate", "technology", "gather"]
        : source.domain === "society"
          ? ["invitation_accept", "trade_accept", "steal"]
          : ["flood", "gather", "world_adjust"];
    const relevant = context.globalEvents
      .filter((e) => kinds.some((k) => e.type.includes(k)))
      .slice(-3);
    return {
      sourceId: source.id,
      application: `阅读提示（非模型推理）：${source.application} 请结合下列航程事件核对，不据论文自动改变名单。`,
      eventSeqs: (relevant.length
        ? relevant
        : context.globalEvents.slice(0, 1)
      ).map((e) => e.seq),
    };
  });
}
