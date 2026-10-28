import { readFileSync } from "node:fs";
import { MAP, TILES, FLAGS } from "./map.js";
const read = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../data/expedition/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
export const CARDS = read("cards");
export const CHARACTERS = read("characters").characters;
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
  map: { ...MAP, tiles: TILES, flags: FLAGS },
  rules: {
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
