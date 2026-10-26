// An explicitly labelled deterministic fallback, not a claim of real-world proof.
export function createTaskAssessor({ godRepository, verdictModel }) {
  return async (session, report) => {
    let completed = /已完成/.test(report) && !/未完成|没有完成|尚未|未能|没完成/.test(report);
    let reason = completed
      ? "试玩规则识别到“已完成”的玩家自述；线下真实性仍需同桌玩家确认。"
      : "当前自述不足以按试玩规则判定完成，请补充实际行动和结果。";
    const metadata = {
      used: false,
      model: verdictModel?.model || null,
      fallbackReason: "not_configured",
    };
    if (verdictModel?.enabled) {
      try {
        const god = await godRepository.get(session.god.id);
        const assessment = await verdictModel.generateAssessment({
          god,
          state: session.stateSnapshot,
          evidence: session.rag.evidence,
          task: session.task || session.initialVerdict,
          report,
        });
        completed = assessment.completed;
        reason = assessment.reason;
        metadata.used = true;
        metadata.fallbackReason = null;
      } catch (error) {
        metadata.fallbackReason = /^(http_\d+|timeout|invalid_\w+|empty_response)$/.test(
          error.message,
        )
          ? error.message
          : "assessment_failed";
      }
    }
    return { completed, reason, ...metadata };
  };
}
