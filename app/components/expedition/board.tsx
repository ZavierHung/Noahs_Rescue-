"use client";
import { useState } from "react";
import type { Catalog, Game, Tile } from "@/lib/expedition";
import { ResourceSvg } from "./resources";
const colors = [
  "#f9c668",
  "#8bcbe6",
  "#eb9d84",
  "#a6d697",
  "#b5a5e1",
  "#f6df95",
];
export function Board({
  catalog,
  game,
  selected,
  onSelect,
  onFlag,
}: {
  catalog: Catalog;
  game: Game | null;
  selected: string | null;
  onSelect: (id: string) => void;
  onFlag?: (id: string) => void;
}) {
  const [grid, setGrid] = useState(true);
  function points(t: Tile) {
    return Array.from({ length: 6 }, (_, i) => {
      const a = ((i * 60 - 30) * Math.PI) / 180;
      return `${t.x + catalog.map.radius * Math.cos(a)},${t.y + catalog.map.radius * Math.sin(a)}`;
    }).join(" ");
  }
  const byId = new Map(catalog.map.tiles.map((t) => [t.id, t]));
  const directions = [
    [1, 0],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [0, -1],
    [1, -1],
  ];
  const borders = catalog.map.tiles
    .flatMap((t) =>
      directions.flatMap(([q, r], side) => {
        const other = byId.get(`${t.q + q},${t.r + r}`);
        if (!other || other.zone <= t.zone) return [];
        const a = ((side * 60 - 30) * Math.PI) / 180,
          b = a + Math.PI / 3;
        return [
          `M${t.x + catalog.map.radius * Math.cos(a)},${t.y + catalog.map.radius * Math.sin(a)} L${t.x + catalog.map.radius * Math.cos(b)},${t.y + catalog.map.radius * Math.sin(b)}`,
        ];
      }),
    )
    .join(" ");
  return (
    <div className="island-wrap">
      <div className="map-tools">
        <span>六边形岛屿 · 点击格子查看 / 移动</span>
        <button onClick={() => setGrid(!grid)}>
          {grid ? "隐藏" : "显示"}格网
        </button>
      </div>
      <svg
        className="island-map"
        viewBox="0 0 1000 1000"
        role="group"
        aria-label="诺亚岛六边形地图"
      >
        <image
          href={catalog.map.image}
          width="1000"
          height="1000"
          preserveAspectRatio="xMidYMid meet"
        />
        {catalog.map.tiles.map((t) => {
          const wet =
              t.terrain === "water" ||
              (!!game && t.zone > 0 && t.zone >= 4 - game.floodLevel),
            canMove = !!game?.reachable[t.id],
            exhausted =
              !!game?.world.harvested[t.id] &&
              game.activeDisasters.some((c) => c.id === "eco-collapse");
          return (
            <g
              key={t.id}
              role="button"
              tabIndex={0}
              aria-label={`格子 ${t.id}，${wet ? "淹没或水域" : t.zone ? `区域${t.zone}` : "方舟范围"}，${t.resource ? catalog.resources[t.resource] : "无资源"}${exhausted ? "，已枯竭" : ""}`}
              onClick={() => onSelect(t.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(t.id);
                }
              }}
            >
              <title>
                {t.id} · {t.resource ? catalog.resources[t.resource] : "无资源"}{" "}
                · {wet ? "水域 / 已淹没" : `区域 ${t.zone}`}
              </title>
              <polygon
                points={points(t)}
                fill={
                  selected === t.id
                    ? "#ffe9a2"
                    : wet
                      ? "#2f8cbb"
                      : canMove
                        ? "#cfffc0"
                        : "transparent"
                }
                fillOpacity={
                  selected === t.id ? 0.65 : wet ? 0.65 : canMove ? 0.45 : 0
                }
                stroke={
                  selected === t.id
                    ? "#fff3a0"
                    : canMove
                      ? "#e2ffc4"
                      : grid
                        ? "#f1deb777"
                        : "none"
                }
                strokeWidth={selected === t.id ? 3 : 1}
              />
              {grid &&
                t.resource &&
                !wet &&
                (exhausted ? (
                  <text className="map-resource" x={t.x} y={t.y + 5}>
                    ×
                  </text>
                ) : (
                  <g pointerEvents="none" aria-hidden="true">
                    <circle
                      cx={t.x}
                      cy={t.y}
                      r={10}
                      fill="#fff7df"
                      fillOpacity=".92"
                    />
                    <ResourceSvg
                      resource={t.resource}
                      className={`resource-${t.resource}`}
                      x={t.x - 9}
                      y={t.y - 9}
                      width={18}
                      height={18}
                    />
                  </g>
                ))}
            </g>
          );
        })}
        {grid && (
          <path
            d={borders}
            fill="none"
            stroke="#ffe3a1"
            strokeWidth="2.5"
            strokeDasharray="5 3"
            pointerEvents="none"
          >
            <title>洪水区域边界：外环 R3、中环 R5、内环 R7，中心为方舟</title>
          </path>
        )}
        {!game &&
          catalog.map.flags.map((f) => (
            <g
              className="spawn-pin"
              key={f.id}
              role="button"
              tabIndex={0}
              aria-label={`出生旗子 ${f.id}`}
              onClick={() => onFlag?.(f.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onFlag?.(f.id);
              }}
            >
              <circle cx={f.x} cy={f.y} r="24" />
              <text x={f.x} y={f.y + 6}>
                {f.id}
              </text>
            </g>
          ))}
        {game?.players.map((p, i) => {
          const t = catalog.map.tiles.find((t) => t.id === p.position)!,
            character = catalog.characters.find((c) => c.id === p.characterId)!;
          const same = game.players.filter((o) => o.position === p.position),
            offset =
              same.length > 1
                ? (same.indexOf(p) - (same.length - 1) / 2) * 14
                : 0;
          return (
            <g
              key={p.id}
              transform={`translate(${t.x + offset},${t.y})`}
              pointerEvents="none"
            >
              <defs>
                <clipPath id={`pawn-${p.id}`}>
                  <circle r="15" />
                </clipPath>
              </defs>
              <circle
                r={p.id === game.activePlayerId ? 19 : 17}
                fill={colors[i]}
                stroke="#fff5d6"
                strokeWidth="2"
              />
              <image
                href={character.image}
                x="-18"
                y="-29"
                width="36"
                height="62"
                clipPath={`url(#pawn-${p.id})`}
                preserveAspectRatio="xMidYMid slice"
              />
              <rect
                x="-15"
                y="14"
                width="30"
                height="16"
                rx="4"
                fill={colors[i]}
              />
              <text x="0" y="26" className="pawn-label">
                {p.id}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="map-caption">
        <span>外环 R3 → 中环 R5 → 内环 R7</span>
        <span>金色虚线为区界 · 中心为方舟</span>
      </div>
    </div>
  );
}
