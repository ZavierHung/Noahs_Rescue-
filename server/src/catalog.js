import { readFileSync } from 'node:fs';

export const DIMENSION_LABELS = { economy: '经济', environment: '环境', society: '社会' };
const catalog = JSON.parse(readFileSync(new URL('../data/disasters.json', import.meta.url), 'utf8'));
const art = JSON.parse(readFileSync(new URL('../data/disaster-art.json', import.meta.url), 'utf8'));
export const DISASTER_VERSION = catalog.version;
export const DISASTERS = Object.fromEntries(Object.keys(DIMENSION_LABELS).map((dimension) => [
  dimension,
  Object.fromEntries(['criticalLow', 'low', 'high', 'criticalHigh'].map((band) => {
    const cards = catalog.cards.filter((card) => card.dimension === dimension && card.band === band).map((card) => {
      const image = art.assets[card.id];
      if (!image || image.sourceImage !== card.sourceImage) throw new Error(`灾难卡缺少匹配图片：${card.id}`);
      return { ...card, catalogVersion: catalog.version, image: { file: image.file, width: image.width, height: image.height } };
    });
    if (!cards.length) throw new Error(`灾难卡分档为空：${dimension}/${band}`);
    return [band, cards];
  })),
]));

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
    const candidates = DISASTERS[dimension][band];
    // Keep the selected identity, NOT obsolete effect text cached in a save file.
    const chosen = candidates.find((card) => card.id === existing?.id)
      || candidates[Math.floor(random() * candidates.length)];
    return [{ ...structuredClone(chosen), dimensionLabel: DIMENSION_LABELS[dimension], triggerValue: value }];
  });
}

export function refreshWorldDisasters(state) {
  return { ...state, activeDisasters: resolveDisasters(state.attributes, state.activeDisasters) };
}

// Upgrade live games, not historical judgment snapshots or completed games.
// A successful later transaction persists the refreshed active card metadata.
export function refreshRoomDisasters(room) {
  return room.status === 'finished' ? room : {
    ...room, activeDisasters: resolveDisasters(room.scores.world, room.activeDisasters),
  };
}
