// Regular pointy-top axial hexagons; artwork coordinates are normalized to 1000.
// Data annotations are separate from the renderer and can be calibrated later.
export const MAP = {
  image: "/images/expedition/map.jpg",
  size: 1000,
  center: [500, 500],
  radius: 20.8,
  version: "island-v1",
};
const directions = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];
export const keyOf = (q, r) => `${q},${r}`;
export const distance = (a, b) =>
  (Math.abs(a.q - b.q) +
    Math.abs(a.r - b.r) +
    Math.abs(a.q + a.r - b.q - b.r)) /
  2;
export function center(q, r) {
  return [
    500 + Math.sqrt(3) * MAP.radius * (q + r / 2),
    500 + 1.5 * MAP.radius * r,
  ];
}
export function polygon(tile) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = ((i * 60 - 30) * Math.PI) / 180;
    return `${tile.x + MAP.radius * Math.cos(a)},${tile.y + MAP.radius * Math.sin(a)}`;
  }).join(" ");
}
const tiles = [];
for (let q = -18; q <= 18; q++)
  for (let r = -15; r <= 15; r++) {
    const [x, y] = center(q, r),
      radius = Math.hypot(x - 500, y - 500);
    if (((x - 500) / 438) ** 2 + ((y - 500) / 443) ** 2 > 1) continue;
    // Main lake and river mouth from the supplied image. Thin rivers remain crossable.
    const water =
      ((x - 338) / 45) ** 2 + ((y - 754) / 50) ** 2 < 1 ||
      ((x - 697) / 45) ** 2 + ((y - 253) / 27) ** 2 < 1;
    tiles.push({
      id: keyOf(q, r),
      q,
      r,
      x,
      y,
      zone: radius > 330 ? 3 : radius > 225 ? 2 : radius > 93 ? 1 : 0,
      terrain: water ? "water" : "land",
      resource: null,
    });
  }
const nearest = (x, y) =>
  tiles
    .filter((t) => t.terrain === "land")
    .sort(
      (a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y),
    )[0];
const riverPaths = [
  [
    [493, 130],
    [500, 180],
    [522, 200],
    [522, 235],
    [546, 260],
    [600, 270],
    [643, 300],
    [649, 340],
    [625, 382],
  ],
  [
    [233, 280],
    [255, 305],
    [278, 330],
    [280, 373],
    [300, 411],
    [330, 430],
    [342, 461],
    [339, 500],
    [351, 540],
    [340, 602],
    [352, 660],
    [343, 701],
  ],
  [
    [557, 760],
    [580, 730],
    [588, 690],
    [590, 650],
    [627, 620],
  ],
];
function segmentDistance(x, y, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    t = Math.max(
      0,
      Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)),
    );
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}
for (const tile of tiles)
  tile.river = riverPaths.some((points) =>
    points.some(
      (b, i) => i > 0 && segmentDistance(tile.x, tile.y, points[i - 1], b) < 12,
    ),
  );
// Hand-calibrated centers of the actual resource symbols, not random scattering.
const resourceMarkers = {
  wood: [
    [339, 164],
    [676, 191],
    [733, 225],
    [229, 284],
    [341, 287],
    [286, 323],
    [461, 376],
    [727, 352],
    [792, 321],
    [770, 394],
    [856, 384],
    [251, 380],
    [172, 445],
    [195, 535],
    [343, 536],
    [106, 631],
    [176, 633],
    [341, 666],
    [535, 631],
    [782, 638],
    [691, 721],
    [410, 854],
    [693, 881],
  ],
  metal: [
    [361, 129],
    [416, 164],
    [542, 135],
    [458, 319],
    [537, 318],
    [408, 354],
    [122, 351],
    [178, 382],
    [91, 415],
    [88, 474],
    [254, 448],
    [389, 442],
    [624, 412],
    [680, 445],
    [842, 541],
    [586, 533],
    [377, 539],
    [299, 600],
    [429, 632],
    [108, 563],
    [783, 695],
    [841, 725],
    [659, 754],
    [732, 787],
    [794, 791],
    [626, 908],
  ],
  seed: [
    [295, 145],
    [453, 101],
    [515, 101],
    [603, 130],
    [446, 165],
    [464, 194],
    [324, 258],
    [423, 259],
    [500, 260],
    [801, 475],
    [876, 469],
    [748, 505],
    [248, 506],
    [148, 663],
    [177, 694],
    [232, 666],
    [237, 718],
    [681, 634],
    [576, 697],
    [638, 696],
    [264, 787],
    [551, 769],
    [592, 791],
    [661, 794],
    [604, 820],
    [624, 852],
    [573, 879],
  ],
  electricity: [
    [229, 231],
    [378, 224],
    [518, 225],
    [568, 193],
    [626, 285],
    [719, 320],
    [361, 381],
    [445, 408],
    [572, 380],
    [304, 475],
    [170, 511],
    [625, 475],
    [889, 509],
    [715, 566],
    [391, 564],
    [482, 598],
    [592, 600],
    [653, 601],
    [464, 697],
    [263, 724],
    [546, 727],
    [463, 761],
    [321, 823],
    [391, 823],
    [515, 850],
  ],
};
for (const [resource, points] of Object.entries(resourceMarkers))
  for (const [x, y] of points) nearest(x, y).resource = resource;
const flags = [
  [454, 85],
  [850, 258],
  [872, 705],
  [478, 924],
  [129, 707],
  [124, 299],
].map(([x, y], i) => ({ id: `P${i + 1}`, tileId: nearest(x, y).id, x, y }));
for (const flag of flags) {
  const t = tiles.find((t) => t.id === flag.tileId);
  t.flag = flag.id;
  t.resource = null;
}
export const TILES = tiles;
export const FLAGS = flags;
export const tileById = (id) => TILES.find((t) => t.id === id);
export const neighbors = (tile) =>
  directions
    .map(([q, r]) => tileById(keyOf(tile.q + q, tile.r + r)))
    .filter(Boolean);
export const flooded = (tile, level) => tile.zone > 0 && tile.zone >= 4 - level;
export function reachable(
  fromId,
  steps,
  level,
  { escape = false, away = false } = {},
) {
  const origin = tileById(fromId),
    seen = new Map([[fromId, []]]),
    queue = [origin];
  while (queue.length) {
    const at = queue.shift(),
      path = seen.get(at.id);
    if (path.length >= steps) continue;
    for (const next of neighbors(at)) {
      if (seen.has(next.id) || next.terrain === "water") continue;
      if (
        flooded(next, level) &&
        !(
          escape &&
          Math.hypot(next.x - 500, next.y - 500) <
            Math.hypot(at.x - 500, at.y - 500)
        )
      )
        continue;
      if (
        away &&
        distance(next, tileById("0,0")) <= distance(origin, tileById("0,0"))
      )
        continue;
      seen.set(next.id, [...path, next.id]);
      queue.push(next);
    }
  }
  return Object.fromEntries(seen);
}
