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
import { WorldPanel } from "./world-panel";
import { DisasterChoice } from "./disaster-choice";
import { PlayerInspector } from "./player-inspector";
import { TradePanel } from "./trade-panel";
import { FloodPanel } from "./flood-panel";
import { InvitationPanel } from "./invitation-panel";
import { BoardingPanel } from "./boarding-panel";
import { HistoryPanel } from "./history-panel";
import {
  ResourceIcon,
  ResourceBag,
  ResourceFields as BagFields,
} from "./resources";
import { DisasterCards } from "../game/disaster-cards";
import { CardHint, worldDelta } from "../game/card-hint";
import { GamePurpose } from "./game-purpose";
import { AcademicLibrary } from "./knowledge-panel";
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
  disaster: "灾难结算",
  evacuation: "最后撤离",
};
type Seat = { characterId: string; flagId: string; name: string };
export default function ExpeditionGame() {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [game, setGame] = useState<Game | null>(null),
    [games, setGames] = useState<
      { id: string; round: number; status: string }[]
    >([]);
  const [seats, setSeats] = useState<Seat[]>([]),
    [editing, setEditing] = useState(0);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [preview, setPreview] = useState<{
      name: string;
      image: string;
      implementedEffect?: string;
      effect?: string;
      status?: Record<string, number>;
    } | null>(null);
  const [amounts, setAmounts] = useState<Bag>(blank),
    [spend, setSpend] = useState<Bag>(blank),
    [resource, setResource] = useState<Resource>("wood"),
    [target, setTarget] = useState(""),
    [invitation, setInvitation] = useState<string | null>(null),
    [tech, setTech] = useState<string | null>(null);
  const [tradeNotice, setTradeNotice] = useState("");
  const [tab, setTab] = useState<"log" | "donations" | "history" | "rules">(
    "log",
  );
  // null follows the server's current actor. A pinned inspection is local UI
  // state only: it never changes game.turn, pending.actor or the command actor.
  const [inspection, setInspection] = useState<{
    gameId: string;
    playerId: string;
  } | null>(null);
  const viewedPlayerId =
    inspection &&
    game &&
    inspection.gameId === game.id &&
    game.players.some((p) => p.id === inspection.playerId)
      ? inspection.playerId
      : game?.activePlayerId;
  const inspectingOther = !!game && viewedPlayerId !== game.activePlayerId;
  useEffect(() => {
    if (
      game &&
      inspection?.gameId === game.id &&
      inspection.playerId === game.activePlayerId
    )
      setInspection(null);
  }, [game?.id, game?.activePlayerId, inspection]);
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
        c.characters.slice(0, 3).map((c, i) => ({
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
    setSelected(null);
  }, [
    game?.id,
    game?.activePlayerId,
    game?.phase,
    game?.pending?.kind,
    game?.history?.lastChangeRevision,
    viewedPlayerId,
  ]);
  useEffect(() => {
    setPreview(null);
    const change = game?.historyAudit?.at(-1);
    setTradeNotice(
      change?.type === "undo"
        ? "已撤回整步操作；可在「撤回与重做记录」查看留档。"
        : change?.type === "redo"
          ? "已重做原操作，恢复原结果，未重新抽牌或投骰。"
          : "",
    );
  }, [game?.id, game?.history?.lastChangeRevision]);
  useEffect(() => {
    if (!preview) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [preview]);
  async function act(type: string, data: Record<string, unknown> = {}) {
    if (!game || busy) return false;
    if (
      (game.status === "playing" ||
        ["discuss", "undo", "redo"].includes(type)) &&
      inspectingOther
    ) {
      setError("当前为只读查看，请返回当前行动玩家后操作");
      return false;
    }
    setBusy(true);
    setError("");
    setTradeNotice("");
    try {
      accept(
        await apiRequest<Game>(`/${game.id}/actions`, "POST", {
          ...data,
          type,
          actor: game.activePlayerId,
          revision: data.revision ?? game.revision,
        }),
      );
      if (game.pending?.kind === "trade" && type === "choose") {
        const owner = game.players.find((p) => p.id === game.pending.owner);
        setTradeNotice(
          data.accept
            ? `交换已完成，双方物资已结算。返回 ${owner?.id} · ${owner?.name} 继续原行动。`
            : `对方已拒绝；物资与邀约卡均保留。返回 ${owner?.id} · ${owner?.name}，可以换人重试。`,
        );
      }
      if (game.pending?.kind === "invitation" && type === "choose")
        setTradeNotice(
          data.accept
            ? "邀约已完成，双方各获得一份自选资源，返回发起者继续行动。"
            : "对方拒绝，未增加或扣除资源，邀约卡保留，可重试。",
        );
      return true;
    } catch (e) {
      setError((e as Error).message);
      try {
        accept(await apiRequest<Game>(`/${game.id}`));
      } catch {}
      return false;
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
    setTradeNotice("");
    localStorage.removeItem("noah-expedition-id");
    void apiRequest<{ id: string; round: number; status: string }[]>("").then(
      setGames,
    );
  }
  function openInvitation(uid: string) {
    setError("");
    setTradeNotice("");
    setInvitation(uid);
    const panel = document.querySelector<HTMLElement>(".trade-panel");
    panel?.focus({ preventScroll: true });
    panel?.scrollIntoView({ block: "start" });
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
    viewedPlayer = g?.players.find((player) => player.id === viewedPlayerId),
    tile = cat.map.tiles.find((t) => t.id === (selected || p?.position));
  const techCard = cat.cards.technology.find((c) => c.id === tech),
    pending = g?.pending;
  const card = (id: string) =>
    [...cat.cards.actions, ...cat.cards.technology].find((c) => c.id === id)!;
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
          aria-label={`${cat.resources[r]}${available ? ` ${available[r]}` : ""}`}
          disabled={busy || (!!available && !available[r])}
          key={r}
          onClick={() => onChoose(r)}
        >
          <ResourceIcon resource={r} />
          {available ? ` ${available[r]}` : ""}
        </button>
      ))}
    </div>
  );
  function Artwork({ c }: { c: Card }) {
    return (
      <CardHint card={c}>
        <button
          className="art-button"
          aria-label={`查看${c.name}卡面`}
          onClick={() => setPreview(c)}
        >
          <img src={c.image} alt={c.name} />
        </button>
      </CardHint>
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
          <GamePurpose />
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
                  <CardHint card={c} key={c.id}>
                    <button
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
                  </CardHint>
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
                <p className="fineprint">
                  方舟容量由实际库存自动计算，最多 {seats.length}{" "}
                  人；上帝不能突破容量或批准未存活玩家。
                </p>
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
              <CardHint card={cat.floodCard}>
                <button onClick={() => setPreview(cat.floodCard)}>
                  查看洪水卡 ↗
                </button>
              </CardHint>
            </div>
          </div>
          <div className="player-view-status" aria-label="玩家查看与行动状态">
            <div aria-live="polite">
              <strong>
                {g.status === "playing"
                  ? `当前行动：${p?.id} · ${p?.name}`
                  : "航程已结束 · 玩家信息只读"}
              </strong>
              <p>
                {inspectingOther
                  ? `正在查看 ${viewedPlayer?.id} · ${viewedPlayer?.name}，仅可查看。`
                  : "当前跟随行动玩家；点击下方玩家卡可查看其他人的手牌与详情。"}
                {g.status === "playing" &&
                  g.pending &&
                  " 正在处理系统指定的卡牌回应或结算，不代表切换正常回合。"}
              </p>
            </div>
            {inspectingOther && (
              <button onClick={() => setInspection(null)}>
                {g.status === "playing" ? "返回当前行动玩家" : "返回默认视角"}
              </button>
            )}
          </div>
          {tradeNotice && (
            <p className="interaction-result" role="status">
              {tradeNotice}
            </p>
          )}
          <HistoryPanel
            key={g.id}
            game={g}
            busy={busy}
            readOnly={inspectingOther}
            act={act}
          />
          {g.status === "playing" &&
            ((invitation === "beacon" && !pending && !inspectingOther) ||
              pending?.kind === "trade") && (
              <TradePanel
                card={card("aid-beacon")}
                key={`${g.id}-${g.history?.lastChangeRevision}-${pending?.kind === "trade" ? `response-${pending.cardUid}-${pending.actor}` : invitation}`}
                game={g}
                invitation={invitation}
                busy={busy}
                readOnly={inspectingOther}
                error={error}
                onClose={() => setInvitation(null)}
                onReturn={() => setInspection(null)}
                act={act}
              />
            )}
          {g.status === "playing" &&
            ((invitation &&
              invitation !== "beacon" &&
              !pending &&
              !inspectingOther) ||
              pending?.kind === "invitation") && (
              <InvitationPanel
                card={card("invitation")}
                key={`invitation-${g.id}-${g.history?.lastChangeRevision}-${pending?.kind === "invitation" ? pending.actor : invitation}`}
                game={g}
                cardUid={invitation}
                busy={busy}
                readOnly={inspectingOther}
                error={error}
                onClose={() => setInvitation(null)}
                onReturn={() => setInspection(null)}
                act={act}
              />
            )}
          {g.status === "playing" &&
            g.events.some((e) => e.type === "flood" && e.round === g.round) && (
              <FloodPanel
                key={`flood-${g.id}-${g.history?.lastChangeRevision}`}
                game={g}
                busy={busy}
                readOnly={inspectingOther}
                act={act}
                onReturn={() => setInspection(null)}
              />
            )}
          <WorldPanel
            key={`${g.id}-${viewedPlayerId}-${g.history?.lastChangeRevision}`}
            game={g}
            busy={busy}
            readOnly={inspectingOther}
            tile={tile}
            act={act}
          />
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
                    {tile.resource ? (
                      <ResourceIcon resource={tile.resource} />
                    ) : (
                      "无资源"
                    )}
                  </span>
                  <span>
                    {g.reachable[tile.id]
                      ? `路径 ${g.reachable[tile.id].length} 格`
                      : "不在本步可移动范围"}
                  </span>
                </div>
              )}
              <div className="player-roster" aria-label="玩家列表">
                {g.players.map((player) => (
                  <article
                    key={player.id}
                    className={`${player.id === g.activePlayerId ? "active" : ""} ${player.id === viewedPlayerId ? "inspected" : ""}`}
                  >
                    <CardHint
                      card={
                        cat.characters.find(
                          (c) => c.id === player.characterId,
                        ) || { name: player.name }
                      }
                    >
                      <button
                        className="roster-select"
                        aria-label={`查看 ${player.id} 玩家详情`}
                        aria-pressed={player.id === viewedPlayerId}
                        onClick={() =>
                          setInspection(
                            player.id === g.activePlayerId
                              ? null
                              : { gameId: g.id, playerId: player.id },
                          )
                        }
                      >
                        <img
                          src={
                            cat.characters.find(
                              (c) => c.id === player.characterId,
                            )?.image
                          }
                          alt={player.name}
                        />
                        <span className="roster-summary">
                          <strong>
                            {player.id} · {player.name}
                          </strong>
                          <span className="roster-line">
                            <ResourceBag value={player.resources} />
                          </span>
                          <small>
                            出生 {player.spawn} · 当前格 {player.position}
                          </small>
                          <small>
                            伤势 {player.survivalPreview.injury} · 种子救生后{" "}
                            {player.survivalPreview.remainingInjury} / 耐受{" "}
                            {player.survivalPreview.tolerance}
                            {g.status !== "playing"
                              ? player.survivalPreview.alive
                                ? " · 幸存"
                                : " · 未存活"
                              : "（预览）"}
                          </small>
                          <span className="roster-line">
                            已捐赠{" "}
                            {keys.reduce((n, r) => n + player.donated[r], 0)} 份
                          </span>
                          <span className="roster-view-label">
                            {player.id === g.activePlayerId &&
                            g.status === "playing"
                              ? "当前行动"
                              : "只读查看"}
                            {player.id === viewedPlayerId
                              ? " · 正在查看"
                              : " · 点击查看手牌"}
                          </span>
                        </span>
                      </button>
                    </CardHint>
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
                      <ResourceIcon resource={r} />
                      <b>{g.ark[r]}</b>
                    </div>
                  ))}
                </div>
                <small>
                  库存 {g.capacity.units} 份，每 {g.capacity.unitsPerSeat}{" "}
                  份支持 1 人，最多 {g.capacity.maxSeats}{" "}
                  人；洪水损失会降低容量。
                  {g.capacity.seats < g.capacity.maxSeats
                    ? `再需 ${g.capacity.nextSeatNeeds} 份增加一席。`
                    : ""}
                </small>
              </section>
              {viewedPlayer && (inspectingOther || g.status !== "playing") && (
                <PlayerInspector
                  player={viewedPlayer}
                  catalog={cat}
                  onPreview={setPreview}
                />
              )}
              {g.status === "playing" && p ? (
                !inspectingOther && (
                  <section className="action-panel">
                    <p className="overline">{p.id} / 轮到你了</p>
                    <h2>{p.name}</h2>
                    <ResourceBag value={p.resources} />
                    <p
                      className={
                        p.survivalPreview.remainingInjury >
                        p.survivalPreview.tolerance
                          ? "interaction-warning"
                          : "fineprint"
                      }
                    >
                      累计伤势 {p.survivalPreview.injury}；按现有种子救生后为{" "}
                      {p.survivalPreview.remainingInjury} / 耐受{" "}
                      {p.survivalPreview.tolerance}
                      。种子在终局才实际消耗，位置也必须安全。
                    </p>
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
                            : ["trade", "invitation"].includes(pending.kind)
                              ? "邀约等待回应"
                              : pending.kind === "flood"
                                ? "洪水缴纳待完成"
                                : pending.kind === "blade"
                                  ? "名刀触发 · 额外移动两格"
                                  : "请选择卡牌效果"}
                        </h3>
                        <DisasterChoice
                          game={g}
                          player={p}
                          catalog={cat}
                          busy={busy}
                          act={act}
                        />
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
                                <p>
                                  {techCard.implementedEffect ||
                                    techCard.effect}
                                </p>
                                {tech === "alchemy-furnace" && (
                                  <>
                                    <BagFields
                                      value={spend}
                                      onChange={setSpend}
                                      label="炼金消耗"
                                      max={p.resources}
                                    />
                                    <fieldset className="resource-output">
                                      <legend>产出资源</legend>
                                      <div className="resource-options">
                                        {keys.map((r) => (
                                          <button
                                            key={r}
                                            aria-label={`产出${cat.resources[r]}`}
                                            aria-pressed={resource === r}
                                            onClick={() => setResource(r)}
                                          >
                                            <ResourceIcon resource={r} />
                                          </button>
                                        ))}
                                      </div>
                                    </fieldset>
                                  </>
                                )}
                                {tech === "recycling-claw" && (
                                  <label>
                                    相邻目标
                                    <select
                                      aria-label="科技目标"
                                      value={target}
                                      onChange={(e) =>
                                        setTarget(e.target.value)
                                      }
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
                        {["trade", "invitation"].includes(pending.kind) && (
                          <button
                            onClick={() =>
                              document
                                .querySelector<HTMLElement>(".trade-panel")
                                ?.focus()
                            }
                          >
                            前往邀约面板接受 / 拒绝
                          </button>
                        )}
                        {pending.kind === "flood" && (
                          <button
                            onClick={() =>
                              document
                                .querySelector<HTMLElement>(".flood-panel")
                                ?.focus()
                            }
                          >
                            前往洪水面板查看并缴纳
                          </button>
                        )}
                        {pending.kind === "evacuation" && (
                          <>
                            <p>
                              所有常规行动结束。可最后向内撤离最多{" "}
                              {g.rules.finalEvacuationSteps}{" "}
                              格；点击地图选择目的地。随后结算生存，不再出牌或采集。
                            </p>
                            <button
                              disabled={
                                busy || !selected || !g.reachable[selected]
                              }
                              onClick={() =>
                                void act("evacuate", { tileId: selected })
                              }
                            >
                              确认最后撤离
                            </button>
                            <button
                              disabled={busy}
                              onClick={() =>
                                void act("evacuate", { tileId: p.position })
                              }
                            >
                              留在当前格
                            </button>
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
                              <CardHint card={card(c.id)} key={c.uid}>
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void act("choose", { cardUid: c.uid })
                                  }
                                >
                                  选择 {card(c.id).name} · {c.uid}
                                </button>
                              </CardHint>
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
                                <CardHint card={card(c.id)} key={c.uid}>
                                  <button
                                    onClick={() =>
                                      void act("choose", { cardUid: c.uid })
                                    }
                                  >
                                    弃置 {card(c.id).name}
                                  </button>
                                </CardHint>
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
                              {!g.canGather &&
                                "当前不能采集：空地、淹没格，或生态崩坏期间已被采集的资源格。"}
                            </p>
                            <button
                              className="primary"
                              disabled={busy || !g.canGather}
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
                              disabled={
                                busy || !keys.some((r) => amounts[r] > 0)
                              }
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
                        {p.hand.length} / {p.handLimit}
                      </small>
                    </div>
                    <div className="hand-cards">
                      {p.hand.map((c) => (
                        <div key={c.uid}>
                          <Artwork c={card(c.id)} />
                          <strong>{card(c.id).name}</strong>
                          <button
                            disabled={
                              busy ||
                              pending?.kind === "evacuation" ||
                              pending?.kind.startsWith("disaster_") ||
                              pending?.kind === "eco_block" ||
                              (!!pending && c.id !== "technology")
                            }
                            onClick={() =>
                              c.id === "technology"
                                ? void act("play", { cardUid: c.uid })
                                : openInvitation(c.uid)
                            }
                          >
                            使用
                          </button>
                          <button
                            className="quiet"
                            disabled={
                              busy ||
                              pending?.kind === "evacuation" ||
                              pending?.kind.startsWith("disaster_") ||
                              pending?.kind === "eco_block"
                            }
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
                          <CardHint card={card(id)} key={id}>
                            <button onClick={() => setPreview(card(id))}>
                              {card(id).name} ↗
                            </button>
                          </CardHint>
                        ))}
                        {p.equipment.includes("aid-beacon") && !pending && (
                          <button onClick={() => openInvitation("beacon")}>
                            使用互助信标交换
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                )
              ) : (
                <BoardingPanel
                  game={g}
                  busy={busy}
                  readOnly={inspectingOther}
                  onReturn={() => setInspection(null)}
                  act={act}
                />
              )}
              <DisasterCards cards={g.activeDisasters} automatic />
            </aside>
          </div>
        </>
      )}
      <section className="chronicle">
        <nav>
          {(["log", "donations", "history", "rules"] as const).map((t) => (
            <button
              className={tab === t ? "selected" : ""}
              onClick={() => setTab(t)}
              key={t}
            >
              {t === "log"
                ? "全局航程日志"
                : t === "donations"
                  ? "方舟捐赠记录"
                  : t === "history"
                    ? "撤回与重做记录"
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
                ：<ResourceBag value={d.amounts} />
              </p>
            ))}
          </div>
        )}
        {tab === "history" && (
          <div className="history-audit">
            <h2>修正留档，不改写已经发生的修正</h2>
            <p>
              下列为撤回、重做及分支关闭记录。被撤回事件不计入有效航程或上帝审议；归档事件序号仅对应当时版本。导出本局
              JSON 包含这些记录，不含内部恢复快照。
            </p>
            <div className="event-list">
              {g?.historyAudit?.toReversed().map((entry) => (
                <details key={entry.seq}>
                  <summary>
                    <span>
                      修正 #{entry.seq} · v{entry.revision} · {entry.actor}
                    </span>
                    {entry.detail}
                  </summary>
                  <pre>{JSON.stringify(entry, null, 2)}</pre>
                </details>
              ))}
              {!g?.historyAudit?.length && <p>暂无撤回或重做记录。</p>}
            </div>
          </div>
        )}
        {tab === "rules" && (
          <div className="rules-copy">
            <GamePurpose />
            <AcademicLibrary />
            <h2>八回合，三次洪水</h2>
            <p>
              行动修正支持最近 20
              步撤回与重做，由当前行动玩家确认，可以跨玩家及回合恢复整局；随机结果不重掷。初次审议前可撤回最后的生存结算，开始上帝审议后锁定。修正单独留档，新操作关闭原重做分支。
            </p>
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
              份；除生态崩坏在场限制外，资源格可逐回合重复采集。邀约可选择物理位置最近两名其他玩家，接受后双方各领一份自选资源，不是交换；互助信标仍按同格或相邻格交换。方舟范围为中心安全区。资源池四类等概率；同名被动不叠加。可以从任何位置上交材料。
            </p>
            <p>
              淹没格禁止采集和逆水深入。洪水欠缴每份积累一点伤势；终局有一次紧急撤离，随后保留种子自动救生。必须处于安全地块且剩余伤势不超过耐受值才算幸存。方舟实际库存决定席位，只有幸存者能参与初判、逐人交互与最终登船评议。完整数值显示在洪水和终局面板。
            </p>
            <p>
              地图采用原图＋规则格网。经济、环境、社会为全体玩家共享的世界值；科技直接影响世界。1—2
              叠加普通负向与极低灾难，18—19
              叠加普通正向与极高灾难。同档不重复执行进入效果；离开后重入可重新触发。生态管制的社会
              −1 为持续修正，离场解除。
            </p>
            <p>
              灾难会实际改变资源、科技、采集和移动。晶矿按金属、保障物资按四类自选处理。资源保护通过条件确认按钮执行。强制互助在每轮末、洪水前结算；稳态失衡进入时移动，本轮末不再重复。自然地块暂按所有资源格计算。细则与完整记录见
              README 和全局日志。
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
            {preview.implementedEffect && (
              <p className="interaction-ready">
                本版实际规则：{preview.implementedEffect}
              </p>
            )}
            {worldDelta(preview) && (
              <p>生效时共享世界：{worldDelta(preview)}；重复被动不叠加。</p>
            )}
            <CardHint card={preview}>
              <img src={preview.image} alt={preview.name} />
            </CardHint>
          </div>
        </div>
      )}
    </main>
  );
}
