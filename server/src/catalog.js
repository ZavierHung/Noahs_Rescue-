export const DIMENSION_LABELS = { economy: '经济', environment: '环境', society: '社会' };

export const DISASTERS = {
  economy: {
    criticalHigh: [
      { id: 'wealth-gap', name: '贫富悬殊', effect: '社会值 -1；资源最少者需向资源最多者交纳 1 资源。' },
    ],
    high: [
      { id: 'develop-first', name: '先发展再治理', effect: '生态值 -1；所有玩家获得 1 资源，之后开采成功率降低 50%。' },
    ],
    low: [{ id: 'depression', name: '经济萧条', effect: '所有经济增益类效果失效。' }],
    criticalLow: [{ id: 'deflation', name: '通货紧缩', effect: '所有玩家手牌上限 -1，并立即失去一张科技牌。' }],
  },
  environment: {
    criticalHigh: [
      { id: 'eco-conflict', name: '生态管制冲突', effect: '社会值 -1；相邻玩家可消耗 1 资源阻止降低生态的行动。' },
      { id: 'reserve-expansion', name: '资源保护区扩大', effect: '经济值 -1；每人每回合最多获得一次资源。' },
    ],
    high: [{ id: 'low-carbon-pain', name: '低碳转型阵痛', effect: '经济值 -1；经济增益行动收益 -1，最低为 0。' }],
    low: [{ id: 'eco-collapse', name: '生态崩坏', effect: '自然资源产出 -1，被采集地块不可再次产出。' }],
    criticalLow: [{ id: 'steady-imbalance', name: '稳态失衡', effect: '所有玩家失去 1 资源，之后每轮随机移动。' }],
  },
  society: {
    criticalHigh: [
      { id: 'collective-delay', name: '集体决策低效', effect: '经济值 -1；建设、投资、升级需至少一名其他玩家同意。' },
      { id: 'mutual-aid', name: '强制互助制度', effect: '经济值 -1；资源最多者每回合向最少者转移 1 资源。' },
    ],
    high: [{ id: 'welfare-pressure', name: '全民保障压力', effect: '生态值 -1；所有人获得 1 资源，之后开采成功率降为 50%。' }],
    low: [{ id: 'social-disorder', name: '社会失序', effect: '禁止远程合作与交易，只能与相邻玩家互动。' }],
    criticalLow: [{ id: 'class-lock', name: '阶层固化', effect: '资源前半玩家采集时可能额外获益，后半玩家可能少获得资源。' }],
  },
};

export function bandFor(value) {
  if (value >= 18) return 'criticalHigh';
  if (value >= 14) return 'high';
  if (value <= 2) return 'criticalLow';
  if (value <= 6) return 'low';
  return 'stable';
}

export function resolveDisasters(attributes, previous = [], random = Math.random) {
  return Object.entries(attributes).flatMap(([dimension, value]) => {
    const band = bandFor(value);
    if (band === 'stable') return [];
    const existing = previous.find((item) => item.dimension === dimension && item.band === band);
    if (existing) return [{ ...existing, triggerValue: value }];
    const candidates = DISASTERS[dimension][band];
    const chosen = candidates[Math.floor(random() * candidates.length)];
    return [{ ...chosen, dimension, dimensionLabel: DIMENSION_LABELS[dimension], band, triggerValue: value }];
  });
}
