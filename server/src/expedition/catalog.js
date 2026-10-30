import { readFileSync } from "node:fs";
import { MAP, TILES, FLAGS } from "./map.js";
import { DEFAULT_RULES } from "./rules.js";
const read = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../data/expedition/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
export const CARDS = read("cards");
export const EFFECT_SUMMARIES = read("effect-summaries");
for (const card of [...CARDS.actions, ...CARDS.technology])
  card.effectSummary = EFFECT_SUMMARIES.cards[card.id];
export const CHARACTERS = read("characters").characters.map((c) => ({
  ...c,
  implementedEffect: EFFECT_SUMMARIES.character,
  effectSummary: EFFECT_SUMMARIES.character,
}));
export const RESOURCES = ["wood", "metal", "electricity", "seed"];
export const LABELS = {
  wood: "木头",
  metal: "金属",
  electricity: "电力",
  seed: "种子",
};
export const getTech = (id) => CARDS.technology.find((c) => c.id === id);
export const publicCatalog = () => ({
  cards: CARDS,
  characters: CHARACTERS,
  resources: LABELS,
  floodCard: {
    name: "洪水上涨追踪",
    image: "/images/expedition/flood.jpg",
    implementedEffect: EFFECT_SUMMARIES.flood,
    effectSummary: EFFECT_SUMMARIES.flood,
  },
  map: { ...MAP, tiles: TILES, flags: FLAGS },
  rules: {
    balance: DEFAULT_RULES,
    disasterPolicy: read("disaster-rules"),
    rounds: 8,
    floodRounds: [3, 5, 7],
    drawAtStart: [1, 2, 5, 6, 7, 8],
    drawAtEnd: [3],
    drawCount: 1,
    baseMove: 2,
    baseHandLimit: 5,
  },
});
