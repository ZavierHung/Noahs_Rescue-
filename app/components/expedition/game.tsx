"use client";
import { useEffect, useRef, useState } from "react";
import {
  apiRequest,
  WEB_VERSION,
  type Bag,
  type Catalog,
  type Game,
  type Resource,
  type Card,
} from "@/lib/expedition";
import { Board } from "./board";
import { DisasterCards } from "../game/disaster-cards";
import "./game.css";
const keys: Resource[] = ["wood", "metal", "electricity", "seed"];
const blank = (): Bag => ({ wood: 0, metal: 0, electricity: 0, seed: 0 });
const phaseNames: Record<string, string> = {
  cards: "使用手牌",
  move: "选择移动",
  gather: "选择采集",
  donate: "上交材料",
  choice: "处理卡牌选择",
  flood: "洪水结算",
  judgment: "终局审判",
};
type Seat = { characterId: string; flagId: string; name: string };
function BagFields({
  value,
  onChange,
  label,
  max,
}: {
  value: Bag;
  onChange: (v: Bag) => void;
  label: string;
  max?: Bag;
}) {
  const names = {
    wood: "木头",
    metal: "金属",
    electricity: "电力",
    seed: "种子",
  };
  return (
    <fieldset className="resource-fields">
      <legend>{label}</legend>
      {keys.map((r) => (
        <label key={r}>
          {names[r]}
          <input
            aria-label={`${label}${names[r]}`}
            type="number"
            min="0"
            max={max?.[r] ?? 999}
            value={value[r]}
            onChange={(e) =>
              onChange({
                ...value,
                [r]: Math.max(0, Math.min(999, Number(e.target.value) || 0)),
              })
            }
          />
        </label>
      ))}
    </fieldset>
  );
}
export default function ExpeditionGame() {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [game, setGame] = useState<Game | null>(null),
    [games, setGames] = useState<
      { id: string; round: number; status: string }[]
    >([]);
  const [seats, setSeats] = useState<Seat[]>([]),
    [editing, setEditing] = useState(0),
    [capacity, setCapacity] = useState(3);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [preview, setPreview] = useState<{ name: string; image: string } | null>(
      null,
    );
  const [amounts, setAmounts] = useState<Bag>(blank),
    [spend, setSpend] = useState<Bag>(blank),
    [resource, setResource] = useState<Resource>("wood"),
    [target, setTarget] = useState(""),
    [invitation, setInvitation] = useState<string | null>(null),
    [give, setGive] = useState<Bag>(blank),
    [receive, setReceive] = useState<Bag>(blank),
    [tech, setTech] = useState<string | null>(null),
    [rebuttal, setRebuttal] = useState("");
  const [tab, setTab] = useState<"log" | "donations" | "rules">("log");
  const version = useRef(0);
  function accept(next: Game) {
    setGame((old) =>
      old?.id === next.id && old.revision > next.revision ? old : next,
    );
    localStorage.setItem("noah-expedition-id", next.id);
  }
  async function load() {
    try {
      const [c, list] = await Promise.all([
        apiRequest<Catalog>("/catalog"),
        apiRequest<{ id: string; round: number; status: string }[]>(""),
      ]);
      setCatalog(c);
      setGames(list);
      setSeats(
        c.characters
          .slice(0, 3)
          .map((c, i) => ({
            characterId: c.id,
            flagId: `P${i * 2 + 1}`,
            name: "",
          })),
      );
      const id = localStorage.getItem("noah-expedition-id");
      if (id) accept(await apiRequest<Game>(`/${id}`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!game) return;
    const id = game.id,
      epoch = version.current;
    const timer = setInterval(() => {
      if (!busy)
        void apiRequest<Game>(`/${id}`)
          .then((g) => {
            if (version.current === epoch) accept(g);
          })
          .catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [game?.id, busy]);
  useEffect(() => {
    setInvitation(null);
    setTech(null);
    setAmounts(blank());
    setSpend(blank());
    setTarget("");
  }, [game?.activePlayerId, game?.phase, game?.pending?.kind]);
  useEffect(() => {
    if (!preview) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [preview]);
  async function act(type: string, data: Record<string, unknown> = {}) {
    if (!game || busy) return;
    setBusy(true);
    setError("");
    try {
      accept(
        await apiRequest<Game>(`/${game.id}/actions`, "POST", {
          type,
          actor: game.activePlayerId,
          revision: game.revision,
          ...data,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
      try {
        accept(await apiRequest<Game>(`/${game.id}`));
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      version.current++;
      accept(
        await apiRequest<Game>("", "POST", {
          players: seats,
          seats: Math.min(capacity, seats.length),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function setup() {
    version.current++;
    setGame(null);
    localStorage.removeItem("noah-expedition-id");
    void apiRequest<{ id: string; round: number; status: string }[]>("").then(
      setGames,
    );
  }
  if (!catalog)
    return (
      <main className="expedition">
        <h1>Noah’s Rescue</h1>
        <p>{error || "正在读取地图与卡牌目录…"}</p>
        <button onClick={() => void load()}>重试连接</button>
      </main>
    );
  const cat = catalog,
    g = game,
    p = g?.players.find((p) => p.id === g.activePlayerId),
    tile = cat.map.tiles.find((t) => t.id === (selected || p?.position));
  const techCard = cat.cards.technology.find((c) => c.id === tech),
    pending = g?.pending;
  const card = (id: string) =>
    [...cat.cards.actions, ...cat.cards.technology].find((c) => c.id === id)!;
  function bagText(b: Bag) {
    return keys.map((r) => `${cat.resources[r]} ${b[r]}`).join(" · ");
  }
  const ResourceChoice = ({
    onChoose,
    available,
  }: {
    onChoose: (r: Resource) => void;
    available?: Bag;
  }) => (
    <div className="resource-options">
      {keys.map((r) => (
        <button
          disabled={busy || (!!available && !available[r])}
          key={r}
          onClick={() => onChoose(r)}
        >
          {cat.resources[r]}
          {available ? ` ${available[r]}` : ""}
        </button>
      ))}
    </div>
  );
  function Artwork({ c }: { c: Card }) {
    return (
      <button
        className="art-button"
        aria-label={`查看${c.name}卡面`}
        onClick={() => setPreview(c)}
      >
        <img src={c.image} alt={c.name} />
      </button>
    );
  }
  return (
    <main className="expedition">
      <header className="exp-header">
        <a href="/" className="exp-brand">
          <span>⚓</span>
          <div>
            <small>A CHANCE TO BEGIN AGAIN</small>
            <h1>Noah’s Rescue</h1>
          </div>
        </a>
        <div className="header-actions">
          <span className="local-chip">本地网页版 · {WEB_VERSION}</span>
          <a href="/lab">世界实验台</a>
          {g && (
            <button onClick={setup} disabled={busy}>
              返回选人 / 新局
            </button>
          )}
        </div>
      </header>
      {error && (
        <div role="alert" className="exp-error">
          {error}
          <button onClick={() => setError("")}>关闭</button>
        </div>
      )}
      {!g ? (
        <>
          <section className="voyage-intro">
            <p className="overline">THE LAST VOYAGE</p>
            <h2>
              潮水将至。
              <br />
              每一次选择，都将留下记录。
            </h2>
            <p>
              选择你的同伴与出生旗子。穿过岛屿，收集物资，建造方舟。
              <br />
              八回合后，上帝将根据每个人的行动，作出最后的登舟裁决。
            </p>
          </section>
          <section className="setup-layout">
            <div>
              <div className="section-label">
                <h2>01 / 选择同行者</h2>
                <span>10 个角色 · 最多 6 人 · 本地轮流操作</span>
              </div>
              <div className="seat-tabs">
                {seats.map((s, i) => (
                  <button
                    className={i === editing ? "selected" : ""}
                    key={i}
                    onClick={() => setEditing(i)}
                  >
                    玩家 {i + 1} · {s.flagId}
                  </button>
                ))}
                <button
                  disabled={seats.length === 6}
                  onClick={() => {
                    const c = cat.characters.find(
                        (c) => !seats.some((s) => s.characterId === c.id),
                      )!,
                      f = cat.map.flags.find(
                        (f) => !seats.some((s) => s.flagId === f.id),
                      )!;
                    setSeats([
                      ...seats,
                      { characterId: c.id, flagId: f.id, name: "" },
                    ]);
                    setEditing(seats.length);
                  }}
                >
                  ＋玩家
                </button>
                {seats.length > 1 && (
                  <button
                    onClick={() => {
                      setSeats(seats.filter((_, i) => i !== editing));
                      setEditing(0);
                    }}
                  >
                    移除此玩家
                  </button>
                )}
              </div>
              <div className="character-grid">
                {cat.characters.map((c) => (
                  <button
                    key={c.id}
                    className={`character-pick ${seats[editing]?.characterId === c.id ? "chosen" : ""}`}
                    disabled={seats.some(
                      (s, i) => i !== editing && s.characterId === c.id,
                    )}
                    onClick={() =>
                      setSeats(
                        seats.map((s, i) =>
                          i === editing ? { ...s, characterId: c.id } : s,
                        ),
                      )
                    }
                  >
                    <img src={c.image} alt={c.name} />
                    <strong>{c.name}</strong>
                    <small>{c.factionLabel}</small>
                  </button>
                ))}
              </div>
              <div className="setup-controls">
                <label>
                  玩家 {editing + 1} 称呼
                  <input
                    aria-label="玩家称呼"
                    maxLength={24}
                    placeholder="默认角色名称"
                    value={seats[editing]?.name || ""}
                    onChange={(e) =>
                      setSeats(
                        seats.map((s, i) =>
                          i === editing ? { ...s, name: e.target.value } : s,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  出生旗子
                  <select
                    aria-label="出生旗子"
                    value={seats[editing]?.flagId}
                    onChange={(e) =>
                      setSeats(
                        seats.map((s, i) =>
                          i === editing ? { ...s, flagId: e.target.value } : s,
                        ),
                      )
                    }
                  >
                    {cat.map.flags.map((f) => (
                      <option
                        key={f.id}
                        disabled={seats.some(
                          (s, i) => i !== editing && s.flagId === f.id,
                        )}
                      >
                        {f.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  方舟席位
                  <input
                    aria-label="方舟席位"
                    type="number"
                    min="1"
                    max={seats.length}
                    value={Math.min(capacity, seats.length)}
                    onChange={(e) => setCapacity(Number(e.target.value))}
                  />
                </label>
              </div>
              <button
                className="primary launch"
                onClick={() => void create()}
                disabled={busy}
              >
                确认角色与旗子 · 开始航程 →
              </button>
              <p className="fineprint">
                每次抽 1
                张行动卡；科技抽二选一。未明确规则采用可迭代本地约定，见下方玩法说明。
              </p>
              {games.length > 0 && (
                <details>
                  <summary>继续已有航程（本地存档）</summary>
                  {games.map((row) => (
                    <button
                      className="saved-game"
                      key={row.id}
                      onClick={async () => {
                        version.current++;
                        try {
                          accept(await apiRequest<Game>(`/${row.id}`));
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      {row.id} · 第 {row.round} 回合 · {row.status}
                    </button>
                  ))}
                </details>
              )}
            </div>
            <div>
              <div className="section-label">
                <h2>02 / 选择出发点</h2>
                <span>点击地图上的 P1—P6</span>
              </div>
              <Board
                catalog={cat}
                game={null}
                selected={selected}
                onSelect={setSelected}
                onFlag={(flagId) => {
                  if (
                    seats.some((s, i) => i !== editing && s.flagId === flagId)
                  ) {
                    setError("这面旗子已被其他玩家选择");
                    return;
                  }
                  setSeats(
                    seats.map((s, i) => (i === editing ? { ...s, flagId } : s)),
                  );
                }}
              />
            </div>
          </section>
        </>
      ) : (
        <>
          <div className="journey-strip">
            <div>
              <p className="overline">{g.id}</p>
              <h2>
                第 {g.round} / 8 回合{" "}
                <span>
                  {g.status === "playing" ? phaseNames[g.phase] : "终局议事厅"}
                </span>
              </h2>
            </div>
            <ol className="round-track">
              {Array.from({ length: 8 }, (_, i) => (
                <li
                  key={i}
                  className={
                    i + 1 === g.round
                      ? "current"
                      : i + 1 < g.round
                        ? "done"
                        : ""
                  }
                >
                  <b>{i + 1}</b>
                  {[3, 5, 7].includes(i + 1) && <small>洪水</small>}
                </li>
              ))}
            </ol>
            <div className="flood-status">
              洪水 {g.floodLevel} / 3
              <button
                onClick={() =>
                  setPreview({
                    name: "洪水上涨追踪",
                    image: "/images/expedition/flood.jpg",
                  })
                }
              >
                查看洪水卡 ↗
              </button>
            </div>
          </div>
          <div className="game-layout">
            <section>
              <Board
                catalog={cat}
                game={g}
                selected={selected}
                onSelect={setSelected}
              />
              {tile && (
                <div className="tile-inspector">
                  <span>
                    格子 {tile.id} ·{" "}
                    {tile.zone ? `Zone ${tile.zone}` : "方舟范围"} ·{" "}
                    {tile.resource ? cat.resources[tile.resource] : "无资源"}
                  </span>
                  <span>
                    {g.reachable[tile.id]
                      ? `路径 ${g.reachable[tile.id].length} 格`
                      : "不在本步可移动范围"}
                  </span>
                </div>
              )}
              <div className="player-roster">
                {g.players.map((player) => (
                  <article
                    key={player.id}
                    className={player.id === g.activePlayerId ? "active" : ""}
                  >
                    <img
                      src={
                        cat.characters.find((c) => c.id === player.characterId)
                          ?.image
                      }
                      alt={player.name}
                    />
                    <div>
                      <strong>
                        {player.id} · {player.name}
                      </strong>
                      <p>{bagText(player.resources)}</p>
                      <small>
                        经济 {player.attributes.economy} · 环境{" "}
                        {player.attributes.environment} · 社会{" "}
                        {player.attributes.society}
                      </small>
                      <p>
                        已捐赠 {keys.reduce((n, r) => n + player.donated[r], 0)}{" "}
                        份
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
            <aside className="exp-sidebar">
              <section className="ark-panel">
                <div className="section-label">
                  <h3>⚓ 方舟物资</h3>
                  <span>{g.seats} 个席位</span>
                </div>
                <div className="ark-resources">
                  {keys.map((r) => (
                    <div key={r}>
                      <span>{cat.resources[r]}</span>
                      <b>{g.ark[r]}</b>
                    </div>
                  ))}
                </div>
                <small>捐赠即时入库，洪水按骰点扣除实际物资。</small>
              </section>
              {g.status === "playing" && p ? (
                <section className="action-panel">
                  <p className="overline">{p.id} / 轮到你了</p>
                  <h2>{p.name}</h2>
                  <div className="phase-track">
                    {["cards", "move", "gather", "donate"].map((s) => (
                      <span className={g.phase === s ? "active" : ""} key={s}>
                        {phaseNames[s]}
                      </span>
                    ))}
                  </div>
                  {pending ? (
                    <div className="pending-choice">
                      <h3>
                        {pending.kind === "technology"
                          ? "科技 · 抽二选一"
                          : pending.kind === "trade"
                            ? "收到资源交换请求"
                            : pending.kind === "flood"
                              ? "支付本次洪水损失"
                              : pending.kind === "blade"
                                ? "名刀触发 · 额外移动两格"
                                : "请选择卡牌效果"}
                      </h3>
                      {pending.kind === "technology" && (
                        <>
                          <div className="tech-options">
                            {pending.choices.map((id: string, i: number) => (
                              <div
                                key={i}
                                className={tech === id ? "chosen" : ""}
                              >
                                <Artwork c={card(id)} />
                                <button onClick={() => setTech(id)}>
                                  {card(id).name}
                                </button>
                              </div>
                            ))}
                          </div>
                          {techCard && (
                            <>
                              <p>{techCard.effect}</p>
                              {tech === "alchemy-furnace" && (
                                <>
                                  <BagFields
                                    value={spend}
                                    onChange={setSpend}
                                    label="炼金消耗"
                                    max={p.resources}
                                  />
                                  <label>
                                    产出
                                    <select
                                      value={resource}
                                      onChange={(e) =>
                                        setResource(e.target.value as Resource)
                                      }
                                    >
                                      {keys.map((r) => (
                                        <option key={r} value={r}>
                                          {cat.resources[r]}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                </>
                              )}
                              {tech === "recycling-claw" && (
                                <label>
                                  相邻目标
                                  <select
                                    aria-label="科技目标"
                                    value={target}
                                    onChange={(e) => setTarget(e.target.value)}
                                  >
                                    <option value="">选择玩家</option>
                                    {g.players
                                      .filter((t) => t.id !== p.id)
                                      .map((t) => (
                                        <option key={t.id} value={t.id}>
                                          {t.name}
                                        </option>
                                      ))}
                                  </select>
                                </label>
                              )}
                              <button
                                className="primary"
                                disabled={busy}
                                onClick={() =>
                                  void act("choose", {
                                    techId: tech,
                                    spend,
                                    resource,
                                    targetId: target,
                                  })
                                }
                              >
                                获得 {techCard.name} 的收益
                              </button>
                            </>
                          )}
                          <button
                            disabled={busy}
                            onClick={() =>
                              void act("choose", { decline: true })
                            }
                          >
                            放弃本次科技收益
                          </button>
                        </>
                      )}
                      {pending.kind === "trade" && (
                        <>
                          <p>
                            {
                              g.players.find((t) => t.id === pending.owner)
                                ?.name
                            }{" "}
                            给你：{bagText(pending.give)}
                          </p>
                          <p>希望你给出：{bagText(pending.receive)}</p>
                          <div className="two-buttons">
                            <button
                              className="primary"
                              disabled={busy}
                              onClick={() =>
                                void act("choose", { accept: true })
                              }
                            >
                              接受交换
                            </button>
                            <button
                              disabled={busy}
                              onClick={() =>
                                void act("choose", { accept: false })
                              }
                            >
                              拒绝
                            </button>
                          </div>
                        </>
                      )}
                      {pending.kind === "flood" && (
                        <>
                          <p>固定扣除：{bagText(pending.cost.mandatory)}</p>
                          <p>
                            {pending.cost.optional
                              ? "再选择一种可用物资扣除 1："
                              : "储备仓已减免 1 份，本次无需选扣。"}
                            不足的固定资源按实际持有扣除，不产生负数。
                          </p>
                          {pending.cost.optional &&
                          pending.cost.choices.some(
                            (r: Resource) =>
                              p.resources[r] > pending.cost.mandatory[r],
                          ) ? (
                            <div className="resource-options">
                              {pending.cost.choices.map((r: Resource) => (
                                <button
                                  key={r}
                                  disabled={
                                    busy ||
                                    p.resources[r] <= pending.cost.mandatory[r]
                                  }
                                  onClick={() =>
                                    void act("pay_flood", { resource: r })
                                  }
                                >
                                  扣除{cat.resources[r]} 1
                                </button>
                              ))}
                            </div>
                          ) : (
                            <button
                              className="primary"
                              disabled={busy}
                              onClick={() => void act("pay_flood")}
                            >
                              确认本次扣除 / 无可扣资源
                            </button>
                          )}
                        </>
                      )}
                      {pending.kind === "blade" && (
                        <>
                          <p>点击地图选择目的地；不移动可选择当前格。</p>
                          <button
                            className="primary"
                            disabled={
                              busy || !selected || !g.reachable[selected]
                            }
                            onClick={() =>
                              void act("blade_move", { tileId: selected })
                            }
                          >
                            确认名刀移动
                          </button>
                          <button
                            onClick={() =>
                              void act("blade_move", { tileId: p.position })
                            }
                          >
                            放弃额外移动
                          </button>
                        </>
                      )}
                      {pending.kind === "supply" && (
                        <>
                          <p>公开补给池 · 每人选一份，最后一份弃置</p>
                          <ResourceChoice
                            available={pending.pool}
                            onChoose={(r) =>
                              void act("choose", { resource: r })
                            }
                          />
                        </>
                      )}
                      {["prototype", "recover"].includes(pending.kind) &&
                        pending.choices.map(
                          (c: { uid: string; id: string }) => (
                            <button
                              key={c.uid}
                              disabled={busy}
                              onClick={() =>
                                void act("choose", { cardUid: c.uid })
                              }
                            >
                              选择 {card(c.id).name} · {c.uid}
                            </button>
                          ),
                        )}
                      {["repeller", "tide"].includes(pending.kind) && (
                        <>
                          <p>
                            {pending.kind === "repeller"
                              ? "弃置一份资源，或点击地图向远离方舟移动一格。"
                              : "弃置一份资源；没有资源则弃一张手牌。"}
                          </p>
                          {keys.some((r) => p.resources[r] > 0) ? (
                            <ResourceChoice
                              available={p.resources}
                              onChoose={(r) =>
                                void act("choose", { resource: r })
                              }
                            />
                          ) : pending.kind === "tide" && p.hand.length ? (
                            p.hand.map((c) => (
                              <button
                                key={c.uid}
                                onClick={() =>
                                  void act("choose", { cardUid: c.uid })
                                }
                              >
                                弃置 {card(c.id).name}
                              </button>
                            ))
                          ) : (
                            <button onClick={() => void act("choose")}>
                              确认无可扣物资
                            </button>
                          )}
                          {pending.kind === "repeller" && (
                            <button
                              disabled={
                                busy ||
                                !selected ||
                                selected === p.position ||
                                !g.reachable[selected]
                              }
                              onClick={() =>
                                void act("choose", { tileId: selected })
                              }
                            >
                              向选中格远离方舟
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  ) : (
                    <>
                      {g.phase === "cards" && (
                        <p>
                          可使用手牌，或保留到后面。科技可以在自己的其它步骤中使用。
                        </p>
                      )}
                      {g.phase === "move" && (
                        <>
                          <p>
                            点击绿色可达格，选择移动 0—2
                            格。滑板鞋可额外移动一格。
                          </p>
                          <button
                            className="primary"
                            disabled={
                              busy || !selected || !g.reachable[selected]
                            }
                            onClick={() =>
                              void act("move", { tileId: selected })
                            }
                          >
                            移动到 {selected || "选中格"}
                          </button>
                        </>
                      )}
                      {g.phase === "gather" && (
                        <>
                          <p>
                            你所在格：{p.position}
                            。只有未淹没的资源格可以采集；物资归个人所有。
                          </p>
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() => void act("gather")}
                          >
                            采集当前位置资源
                          </button>
                        </>
                      )}
                      {g.phase === "donate" && (
                        <>
                          <BagFields
                            value={amounts}
                            onChange={setAmounts}
                            label="上交"
                            max={p.resources}
                          />
                          <button
                            className="primary"
                            disabled={busy || !keys.some((r) => amounts[r] > 0)}
                            onClick={() => void act("donate", { amounts })}
                          >
                            上交材料并结束行动
                          </button>
                        </>
                      )}
                      <button
                        className="skip-action"
                        disabled={busy}
                        onClick={() => void act("skip")}
                      >
                        {g.phase === "cards"
                          ? "完成出牌，进入移动"
                          : g.phase === "move"
                            ? "本回合不移动"
                            : g.phase === "gather"
                              ? "本回合不采集"
                              : "不上交，结束行动"}{" "}
                        →
                      </button>
                    </>
                  )}
                  <div className="hand-heading">
                    <h3>你的手牌</h3>
                    <small>
                      {p.hand.length} /{" "}
                      {p.equipment.includes("space-ring") ? 8 : 5}
                    </small>
                  </div>
                  <div className="hand-cards">
                    {p.hand.map((c) => (
                      <div key={c.uid}>
                        <Artwork c={card(c.id)} />
                        <strong>{card(c.id).name}</strong>
                        <button
                          disabled={
                            busy || (!!pending && c.id !== "technology")
                          }
                          onClick={() =>
                            c.id === "technology"
                              ? void act("play", { cardUid: c.uid })
                              : setInvitation(c.uid)
                          }
                        >
                          使用
                        </button>
                        <button
                          className="quiet"
                          disabled={busy}
                          onClick={() =>
                            void act("discard", { cardUid: c.uid })
                          }
                        >
                          弃置
                        </button>
                      </div>
                    ))}
                  </div>
                  {p.equipment.length > 0 && (
                    <div className="equipment">
                      <h3>已生效科技</h3>
                      {p.equipment.map((id) => (
                        <button key={id} onClick={() => setPreview(card(id))}>
                          {card(id).name} ↗
                        </button>
                      ))}
                      {p.equipment.includes("aid-beacon") && !pending && (
                        <button onClick={() => setInvitation("beacon")}>
                          使用互助信标交换
                        </button>
                      )}
                    </div>
                  )}
                  {invitation && !pending && (
                    <div className="trade-form">
                      <h3>资源交换 · 需要对方同意</h3>
                      <label>
                        相邻玩家
                        <select
                          aria-label="邀约对象"
                          value={target}
                          onChange={(e) => setTarget(e.target.value)}
                        >
                          <option value="">选择对象</option>
                          {g.players
                            .filter((t) => t.id !== p.id)
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <BagFields
                        value={give}
                        onChange={setGive}
                        label="给出"
                        max={p.resources}
                      />
                      <BagFields
                        value={receive}
                        onChange={setReceive}
                        label="请求"
                      />
                      <button
                        className="primary"
                        disabled={busy || !target}
                        onClick={() =>
                          void act(
                            invitation === "beacon" ? "beacon" : "play",
                            {
                              cardUid: invitation,
                              targetId: target,
                              give,
                              receive,
                            },
                          )
                        }
                      >
                        发送交换请求
                      </button>
                      <button onClick={() => setInvitation(null)}>取消</button>
                    </div>
                  )}
                </section>
              ) : (
                <section className="action-panel">
                  <p className="overline">FINAL JUDGMENT</p>
                  <h2>谁能登上方舟？</h2>
                  <p>
                    世界状态、角色人设、本地知识与完整操作日志将共同作为审判依据。
                  </p>
                  {!g.judgment ? (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void act("judge")}
                    >
                      {busy ? "上帝正在查阅全局记录…" : "请上帝审判这段航程"}
                    </button>
                  ) : (
                    <>
                      <h3>{g.judgment.god.name}</h3>
                      <span className="local-chip">
                        {g.judgment.llm.used
                          ? "M3 模型裁决"
                          : "本地规则裁决（未使用 LLM）"}
                      </span>
                      <p>{g.judgment.verdict.statement}</p>
                      {g.judgment.verdict.decisions.map((d: any) => (
                        <article
                          className={`boarding-decision ${d.board ? "admitted" : ""}`}
                          key={d.playerId}
                        >
                          <strong>
                            {d.board ? "准予登舟" : "未获席位"} ·{" "}
                            {g.players.find((p) => p.id === d.playerId)?.name}
                          </strong>
                          <p>{d.reason}</p>
                          <small>
                            依据事件：
                            {d.evidence.map((n: number) => `#${n}`).join("、")}
                          </small>
                        </article>
                      ))}
                      {g.status === "review" && (
                        <>
                          <label>
                            终局申辩（可选，只能一次）
                            <textarea
                              aria-label="终局申辩"
                              maxLength={4000}
                              value={rebuttal}
                              onChange={(e) => setRebuttal(e.target.value)}
                            />
                          </label>
                          <button
                            disabled={busy || !rebuttal.trim()}
                            onClick={() =>
                              void act("rebut", { text: rebuttal })
                            }
                          >
                            提交申辩，听取最终裁决
                          </button>
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() => void act("finalize")}
                          >
                            接受裁决，封存本局
                          </button>
                        </>
                      )}
                      <details className="judgment-history">
                        <summary>初判与申辩留档</summary>
                        {g.judgment.history?.map((h: any, i: number) => (
                          <div key={i}>
                            <h4>
                              {h.stage === "initial"
                                ? "初次裁决"
                                : "申辩后终判"}
                            </h4>
                            {h.rebuttal && <p>申辩：{h.rebuttal}</p>}
                            <p>{h.verdict.statement}</p>
                            {h.verdict.decisions.map((d: any) => (
                              <p key={d.playerId}>
                                {d.playerId} ·{" "}
                                {d.board ? "允许登舟" : "未获席位"}：{d.reason}
                              </p>
                            ))}
                          </div>
                        ))}
                      </details>
                      <details>
                        <summary>本地 RAG 证据与流程</summary>
                        <p>{g.judgment.trace.join(" → ")}</p>
                        {g.judgment.rag.evidence.map((e: any) => (
                          <p key={e.id}>
                            <strong>{e.title}</strong>
                            <br />
                            {e.content}
                          </p>
                        ))}
                      </details>
                    </>
                  )}
                </section>
              )}
              <DisasterCards cards={g.activeDisasters} />
            </aside>
          </div>
        </>
      )}
      <section className="chronicle">
        <nav>
          {(["log", "donations", "rules"] as const).map((t) => (
            <button
              className={tab === t ? "selected" : ""}
              onClick={() => setTab(t)}
              key={t}
            >
              {t === "log"
                ? "全局航程日志"
                : t === "donations"
                  ? "方舟捐赠记录"
                  : "规则与本地约定"}
            </button>
          ))}
        </nav>
        {tab === "log" && (
          <>
            <div className="section-label">
              <h2>每一次行动，都有迹可循。</h2>
              {g && (
                <button
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(g, null, 2)], {
                      type: "application/json",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${g.id}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  导出本局 JSON
                </button>
              )}
            </div>
            <div className="event-list">
              {g?.events.toReversed().map((e) => (
                <details key={e.seq}>
                  <summary>
                    <span>
                      #{e.seq} · R{e.round} · {e.actor}
                    </span>
                    {e.detail}
                  </summary>
                  <pre>{JSON.stringify(e, null, 2)}</pre>
                </details>
              )) || (
                <p>
                  开始游戏后，资源流转、使用卡牌、合作与洪水损失都会记录在这里。
                </p>
              )}
            </div>
          </>
        )}
        {tab === "donations" && (
          <div className="donation-list">
            <h2>捐赠记录不会随洪水扣款消失</h2>
            {g?.donations.map((d, i) => (
              <p key={i}>
                R{d.round} · {g.players.find((p) => p.id === d.playerId)?.name}
                ：{bagText(d.amounts)}
              </p>
            ))}
          </div>
        )}
        {tab === "rules" && (
          <div className="rules-copy">
            <h2>八回合，三次洪水</h2>
            <p>
              第 1、2、5、6、7、8
              回合开始时，每人等概率抽一张邀约或科技行动卡。第 3
              回合末洪水结算后抽牌，第 4 回合不抽。每人依次出牌 → 移动 → 采集 →
              捐赠，可逐项跳过。
            </p>
            <p>
              第 3、5、7 回合末分别淹没外、中、内环。投一枚六面骰，1/2
              扣木头、3/4 扣金属、5/6 扣电力，数量为本次洪水等级
              1/2/3；余额不足只扣实际余额，不重掷。个人损失按洪水卡选择并逐人确认。
            </p>
            <p>
              本地约定：六面旗子各一人、初始资源为 0、手牌上限 5、每次采集 1
              份、资源格可逐回合重复采集。同行者同格或相邻即建立联络，方舟范围为中心安全区。资源池四类等概率；同名被动不叠加。可以从任何位置上交材料。
            </p>
            <p>
              淹没格禁止采集和逆水深入，滞留玩家下一回合可向内逃生，不立即死亡。终局仍在淹没区则不能登舟；席位由开局设置，未擅自设定方舟最低物资门槛。上述未在文档明确的细则可在下一轮修改。
            </p>
            <p>
              地图采用原图＋规则格网；资源图标已人工标定，水域、区域边界为独立规则层。世界三属性为玩家属性均值，科技卡属性作用于使用者。旧灾难卡仍作提示，不自动执行未定义的连锁副作用。
            </p>
            <p>
              这是单机本地轮流操作版，不提供公网账号鉴权。小程序已保存在
              archive/miniprogram-v0.2，与此网页版无运行依赖。
            </p>
          </div>
        )}
      </section>
      <footer className="exp-footer">
        NOAH’S RESCUE / LOCAL EXPEDITION{" "}
        <span>从世界状态，到每一个人的选择。</span>
      </footer>
      {preview && (
        <div
          className="art-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={preview.name}
          onClick={() => setPreview(null)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <button
              autoFocus
              aria-label="关闭卡面"
              onClick={() => setPreview(null)}
            >
              关闭 ×
            </button>
            <h3>{preview.name}</h3>
            <img src={preview.image} alt={preview.name} />
          </div>
        </div>
      )}
    </main>
  );
}
