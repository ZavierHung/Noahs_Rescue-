import { randomUUID } from 'node:crypto';

function assessmentFor(god, attributes) {
  const { economy, environment, society } = attributes;
  const spread = Math.max(economy, environment, society) - Math.min(economy, environment, society);

  if (god.id === 'radical') {
    if (economy >= 14 && environment >= 7) return { classification: '有效发展型', tone: 'reward', title: '突破祝福', measures: ['下一次建设行动成本 -1', '高风险行动失败时可重新判定一次'] };
    if (economy <= 6) return { classification: '停滞保守型', tone: 'penalty', title: '停滞惩罚', measures: ['下一回合资源获取效率 -1', '建设或移动额外消耗 1 资源'] };
    return { classification: '审慎推进型', tone: 'mixed', title: '有条件的突破', measures: ['下一次探索成功率提高', '若环境跌破 7，额外承受一次生态反馈'] };
  }

  if (god.id === 'conservative') {
    if (environment >= 14 && society >= 7) return { classification: '稳健守护型', tone: 'reward', title: '守护庇佑', measures: ['下一次灾难影响减轻', '生态修复效果 +1'] };
    if (environment <= 6 || economy - environment >= 7) return { classification: '过度开采型', tone: 'penalty', title: '自然反噬', measures: ['后续资源获取成功率下降', '下一次灾难影响加重'] };
    return { classification: '谨慎生存型', tone: 'mixed', title: '秩序观察', measures: ['下一次防御行动成功率提高', '高风险行动成本 +1'] };
  }

  if (spread <= 3 && Math.min(economy, environment, society) >= 7) return { classification: '平衡发展型', tone: 'reward', title: '平衡回响', measures: ['下一次合作行动效率 +1', '行动失败时损失减少 1'] };
  if (environment <= 6 || society <= 6) return { classification: '资源透支型', tone: 'penalty', title: '失衡反馈', measures: ['下一次资源收益 -1', '合作行动成功率下降'] };
  return { classification: '混合失衡型', tone: 'mixed', title: '平衡校正', measures: ['优势维度下一次收益保留', '最低维度若未改善，下一轮行动稳定性下降'] };
}

function stateQuery(god, state) {
  const { economy, environment, society } = state.attributes;
  return `${god.values} 经济 ${economy} 环境 ${environment} 社会 ${society} 资源 开采 生态 修复 合作 灾难 韧性`;
}

export function createAgentLoop({ gods, retriever, random = Math.random, now = () => new Date().toISOString() }) {
  return {
    start(state, player = { id: 'player-1', name: '玩家一' }) {
      const god = gods[Math.floor(random() * gods.length)];
      const evidence = retriever.search(stateQuery(god, state), 3);
      const assessment = assessmentFor(god, state.attributes);
      return {
        id: randomUUID(),
        status: 'awaiting_rebuttal',
        createdAt: now(),
        updatedAt: now(),
        player,
        stateSnapshot: structuredClone(state),
        god,
        rag: { model: retriever.model, query: stateQuery(god, state), evidence },
        initialVerdict: {
          ...assessment,
          statement: `${god.voice} 依据当前世界状态，你被判定为“${assessment.classification}”。`,
        },
        rebuttal: null,
        finalVerdict: null,
        trace: [
          { step: 'read_state', status: 'complete' },
          { step: 'select_god', status: 'complete', output: god.id },
          { step: 'retrieve_knowledge', status: 'complete', output: evidence.map((item) => item.id) },
          { step: 'initial_verdict', status: 'complete' },
          { step: 'await_rebuttal', status: 'waiting' },
        ],
      };
    },

    rebut(session, text) {
      if (session.status !== 'awaiting_rebuttal') throw new Error('该审判已完成，不能再次反驳。');
      const hasRemedy = /修复|补偿|合作|共享|降低|恢复|承诺/.test(text);
      const measures = [...session.initialVerdict.measures];
      if (hasRemedy && session.initialVerdict.tone !== 'reward') measures[0] = `若兑现补救承诺，则减免：${measures[0]}`;
      return {
        ...session,
        status: 'final',
        updatedAt: now(),
        rebuttal: { text, submittedAt: now(), recognizedRemedy: hasRemedy },
        finalVerdict: {
          title: session.initialVerdict.title,
          tone: session.initialVerdict.tone,
          statement: hasRemedy
            ? `你的反驳提出了可核验的补救计划，本神予以记录；奖惩不会撤销，但允许以行动争取减免。`
            : `你的立场已被听取，但尚未提供足以改变系统风险的补救措施；原奖惩维持。`,
          measures,
          unavoidable: true,
        },
        trace: [
          ...session.trace.map((step) => step.step === 'await_rebuttal' ? { ...step, status: 'complete' } : step),
          { step: 'evaluate_rebuttal', status: 'complete', output: { recognizedRemedy: hasRemedy } },
          { step: 'final_verdict', status: 'complete' },
          { step: 'archive_json', status: 'complete' },
        ],
      };
    },
  };
}
