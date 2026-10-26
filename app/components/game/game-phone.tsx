"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Leaf, Radio, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  createClient,
  parseRoomCode,
  type Client,
  type View,
  type Scope,
  type Dimension,
} from "../../../miniprogram/shared/client.js";
import { quickStorageKey } from "../../../miniprogram/shared/quick-game.js";
import "../../app/mobile/mobile.css";
import { request, storage } from "@/lib/game-transport";
import { PlayerGuide } from "./player-guide";
import { DisasterCards } from "./disaster-cards";
const noRegister = () => {};

const STATUS = { lobby: "等待加入", playing: "进行中", finished: "已结束" };
type Edit = {
  scope: Scope;
  dimension: Dimension;
  value: number;
  label: string;
  scoreRevision: number;
};

export default function GamePhone({
  roleId: initialRole,
  register = noRegister,
  testMode = false,
  playerMode = false,
}: {
  roleId: string;
  register?: (id: string, client: Client | null) => void;
  testMode?: boolean;
  playerMode?: boolean;
}) {
  const client = useRef<Client | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [report, setReport] = useState("");
  const [rebuttal, setRebuttal] = useState("");
  const [edit, setEdit] = useState<Edit | null>(null);
  const [reason, setReason] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [entryMessage, setEntryMessage] = useState("");
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    action: () => void;
  } | null>(null);
  useEffect(() => {
    const c = createClient({
      request,
      storage,
      storageKey: playerMode
        ? "noah-player-web"
        : testMode
          ? quickStorageKey(initialRole)
          : `noah-simulator-${initialRole}`,
      initialRole,
      onChange: setView,
    });
    client.current = c;
    register(initialRole, c);
    void c.init().then(() => {
      if (testMode || playerMode) c.openGame();
    });
    const timer = setInterval(() => {
      void c.refresh();
    }, 2000);
    return () => {
      clearInterval(timer);
      c.dispose();
      register(initialRole, null);
    };
  }, [initialRole, register, testMode, playerMode]);
  const oracleId = view?.oracle?.id;
  useEffect(() => {
    setReport("");
    setRebuttal("");
  }, [oracleId, view?.roomId, view?.roleId]);
  useEffect(() => {
    setEdit(null);
    setReason("");
    setEntryMessage("");
  }, [view?.roomId, view?.roleId, view?.pending, view?.room?.status]);
  if (!view || !client.current)
    return (
      <section className="phone">
        <div className="screen" role="status">
          正在连接本地游戏服务…
        </div>
      </section>
    );
  const v = view,
    c = client.current,
    room = v.room,
    oracle = v.oracle;
  const roleId = v.roleId;
  const listedRooms = playerMode ? v.myRooms : v.rooms;
  const joinCode = () => {
    setEntryMessage("");
    try {
      void c.join(parseRoomCode(roomCode));
    } catch (error) {
      setEntryMessage((error as Error).message);
    }
  };
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room!.id.slice(5));
      setEntryMessage("房间码已复制，请发送给其他五位玩家。");
    } catch {
      setEntryMessage("无法自动复制，请长按或选中上方房间码复制。");
    }
  };
  const act = (type: string, data?: Record<string, unknown>) => {
    void c.act(type, data);
  };
  const newGame = () =>
    v.pendingCreate
      ? void c.create()
      : v.roomId
        ? setConfirm({
            title: "开始新的一局？",
            description: "原游戏将归档，未确认的奖惩不执行。六个角色需要重新加入新局。",
            action: () => {
              void c.create();
            },
          })
        : void c.create();
  const leave = () =>
    setConfirm({
      title: "暂时离开方舟？",
      description: "不会删除记录，角色席位保留。使用同一浏览器选择这个角色即可重连。",
      action: () => act("leave"),
    });
  const scores = (readOnly = false) => (
    <div className="score-groups">
      {v.scoreGroups.map((group) => (
        <section className={`score-card ${group.scope}`} key={group.scope}>
          <h3>
            {group.label}
            <span>{group.scope === "world" ? "WORLD" : "TEAM SCORE"}</span>
          </h3>
          <div className="score-columns">
            {group.dimensions.map((dim) => (
              <div className={`dimension ${dim.key} ${dim.warning ? "warning" : ""}`} key={dim.key}>
                <span>{dim.label}</span>
                <button
                  aria-label={`调整${group.label}${dim.label}，当前${dim.value}`}
                  disabled={readOnly || v.pending || v.busy}
                  onClick={() => {
                    setEdit({
                      scope: group.scope,
                      dimension: dim.key,
                      value: dim.value,
                      label: `${group.label} · ${dim.label}`,
                      scoreRevision: room!.scoreRevision,
                    });
                    setReason("");
                  }}
                >
                  <strong>{dim.value}</strong>
                  {!readOnly && !v.pending && <small>调整</small>}
                </button>
                <div className="score-track">
                  <i style={{ width: `${(dim.value / 19) * 100}%` }} />
                </div>
                {dim.warning && <small>{dim.value <= 6 ? "低位预警" : "高位预警"}</small>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
  return (
    <section className="phone" aria-label={`${v.role?.name || roleId}的手机`}>
      <header className="brand">
        <div className="brand-line">
          NOAH’S RESCUE <Leaf size={18} />
        </div>
        <span>
          {v.role?.name} · {roleId}{" "}
          <b className={v.connected ? "online" : "offline"}>{v.connected ? "已连接" : "离线"}</b>
        </span>
      </header>
      <div className="screen">
        {entryMessage && (
          <p className="notice" role="status">
            {entryMessage}
          </p>
        )}
        {v.pendingCreate && (
          <div className="notice" role="status">
            上一笔建房请求尚未确认。重试会核实同一请求，不会重复建房。
            <Button variant="outline" disabled={v.busy} onClick={() => void c.create()}>
              重试建房
            </Button>
          </div>
        )}
        {v.error && (
          <div className="notice error" role="alert">
            {v.error}
            <Button variant="ghost" onClick={() => void c.init()}>
              重试连接
            </Button>
          </div>
        )}
        {v.busy && (
          <div className="notice" role="status">
            正在处理，请稍候… 请勿重复提交。
          </div>
        )}
        {v.screen === "role" && (
          <>
            <div className="eyebrow">01 / 角色确认</div>
            {playerMode && (
              <Button variant="outline" className="wide" onClick={() => setGuideOpen(true)}>
                第一次玩？查看玩法
              </Button>
            )}
            <div className="role-hero">
              <img
                className="voyage-art"
                src="/images/ark-companions.jpg"
                alt="耳廓沙狐、金狮绢猴、北极熊与三位人类伙伴同乘方舟"
                width="900"
                height="600"
              />
              <span className={`role-chip ${v.role?.team}`}>{v.role?.badge || roleId}</span>
              <h2>{v.role?.name || "加载角色"}</h2>
              <p>
                {v.role?.team === "animals" ? "动物阵营" : "人类阵营"} · ROLE ID {roleId}
              </p>
            </div>
            {playerMode && (
              <div className="role-grid" aria-label="选择你的角色">
                {v.roles.map((role) => (
                  <Button
                    key={role.id}
                    variant="outline"
                    className={role.id === roleId ? "selected" : ""}
                    disabled={v.busy}
                    onClick={() => c.selectRole(role.id)}
                  >
                    {role.name}
                  </Button>
                ))}
              </div>
            )}
            <p className="muted center">角色卡只代表你的身份，不绑定某一局游戏。</p>
            {room && room.status !== "finished" && (
              <Button className="primary" disabled={v.busy} onClick={() => void c.join(room.id)}>
                回到 {room.id} <ArrowRight />
              </Button>
            )}
            <Button
              className="primary"
              disabled={v.busy || !v.connected}
              onClick={() => c.navigate("rooms")}
            >
              加入游戏
            </Button>
            <Button
              className="wide"
              variant="outline"
              disabled={v.busy || !v.connected}
              onClick={newGame}
            >
              新建一局
            </Button>
            <Button className="wide" variant="ghost" onClick={() => c.navigate("records")}>
              查看历史游戏
            </Button>
          </>
        )}
        {v.screen === "rooms" && (
          <>
            <Back onClick={() => c.navigate("role")} />
            <h2>找到你的方舟</h2>
            <p className="muted">输入同伴给你的 8 位房间码。六位玩家需要加入同一局。</p>
            <form
              className="join-by-code"
              onSubmit={(event) => {
                event.preventDefault();
                joinCode();
              }}
            >
              <label htmlFor={`${roleId}-room-code`}>房间码</label>
              <Input
                id={`${roleId}-room-code`}
                value={roomCode}
                onChange={(event) => setRoomCode(event.target.value)}
                placeholder="例如 A1B2C3D4"
                maxLength={13}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                className="primary"
                type="submit"
                disabled={v.busy || !v.connected || !roomCode.trim()}
              >
                使用房间码加入
              </Button>
            </form>
            {playerMode && <h3>最近参与的游戏</h3>}
            {listedRooms
              .filter((r) => r.status !== "finished")
              .map((r) => (
                <article className="room-card" key={r.id}>
                  <div>
                    <strong>{r.id}</strong>
                    <span className="pill">{STATUS[r.status]}</span>
                  </div>
                  <p>
                    {Object.keys(r.players).length}/6 人 · 动物{" "}
                    {Object.keys(r.players).filter((id) => id.startsWith("A")).length}
                    /3 · 人类 {Object.keys(r.players).filter((id) => id.startsWith("H")).length}
                    /3
                  </p>
                  <Button
                    className="wide"
                    variant="outline"
                    disabled={v.busy}
                    onClick={() => void c.join(r.id)}
                  >
                    {r.players[roleId] ? "以此角色重连" : "加入此局"} <ArrowRight size={16} />
                  </Button>
                </article>
              ))}
            {!listedRooms.some((r) => r.status !== "finished") && (
              <p className="muted">暂无可继续的游戏。输入房间码，或创建新游戏。</p>
            )}
            <Button className="primary" onClick={newGame} disabled={v.busy}>
              创建新游戏
            </Button>
          </>
        )}
        {v.screen === "lobby" && room && (
          <>
            <div className="eyebrow">02 / 等待室</div>
            <h2>
              船员集结中 <span className="count">{v.readyCount}/6</span>
            </h2>
            <p className="game-meta">{room.id}</p>
            <div className="invite-panel">
              <small>邀请同伴的房间码</small>
              <strong>{room.id.slice(5)}</strong>
              <Button variant="outline" onClick={() => void copyCode()}>
                复制房间码
              </Button>
              <p>选择不同角色，全部准备后启航。</p>
            </div>
            {["animals", "humans"].map((team) => (
              <div className="crew" key={team}>
                <h3>
                  {team === "animals" ? "动物阵营" : "人类阵营"} <small>3 个固定席位</small>
                </h3>
                {v.seats
                  .filter((s) => s.team === team)
                  .map((s) => (
                    <div className="seat" key={s.id}>
                      <span className={`avatar ${team}`}>{s.id}</span>
                      <div>
                        <strong>{s.name}</strong>
                        <small>{s.id === roleId ? "这是你" : s.teamLabel}</small>
                      </div>
                      <span className={`seat-state ${s.ready && s.online ? "ready" : ""}`}>
                        {s.online
                          ? s.ready
                            ? "已准备"
                            : "未准备"
                          : s.ready !== undefined
                            ? "已离线"
                            : "等待加入"}
                      </span>
                    </div>
                  ))}
              </div>
            ))}
            <Button
              className="primary"
              disabled={v.busy}
              onClick={() => act("ready", { ready: !v.me?.ready })}
            >
              {v.me?.ready ? "取消准备" : "我已准备"}
            </Button>
            <Button
              className="wide"
              variant="outline"
              disabled={v.busy || v.readyCount !== 6}
              onClick={() => act("start")}
            >
              开始游戏 · {v.readyCount}/6 已准备
            </Button>
            <Button className="wide danger-link" variant="ghost" onClick={leave}>
              退出等待室
            </Button>
          </>
        )}
        {v.screen === "game" && room && (
          <>
            <div className="game-heading">
              <div>
                <div className="eyebrow">{room.id}</div>
                <h2>共同的世界</h2>
              </div>
              <div className="round">
                ROUND<strong>{String(room.round).padStart(2, "0")}</strong>
              </div>
            </div>
            <article className="oracle-card">
              <img
                className="oracle-art"
                src="/images/oracle-sanctuary.jpg"
                alt="水面上的森林神谕圣殿"
                width="900"
                height="600"
              />
              <div className="eyebrow">
                <Radio size={14} /> AI GOD · {oracle?.god.name || "等待神谕"}
              </div>
              <h3>{oracle?.initialVerdict.title || "倾听方舟的声音"}</h3>
              <p>
                {oracle?.initialVerdict.statement ||
                  "手动召唤一位上帝。祂将读取当前世界与团队状态，给出本轮神谕。"}
              </p>
              {oracle && (
                <span className="pill">
                  {v.pending ? (oracle.finalVerdict ? "等待确认结算" : "本回合待回应") : "已结算"}
                </span>
              )}
              <Button
                className="primary"
                disabled={v.busy}
                onClick={() => (v.pending ? c.navigate("report") : act("trigger"))}
              >
                {v.pending ? "回应神谕 / 查看奖惩" : oracle ? "再次触发上帝" : "触发上帝"}{" "}
                <ArrowRight size={16} />
              </Button>
            </article>
            <h3 className="section-title">
              世界与阵营 <small>点击数字调整 · 1—19</small>
            </h3>
            {scores()}
            {edit && (
              <section className="paper score-editor">
                <h3>
                  {edit.label} · {edit.value}
                </h3>
                <Slider
                  aria-label={edit.label}
                  value={[edit.value]}
                  min={1}
                  max={19}
                  step={1}
                  onValueChange={(value) =>
                    setEdit({
                      ...edit,
                      value: Array.isArray(value) ? value[0] : value,
                    })
                  }
                />
                <Input
                  aria-label="分数调整原因"
                  placeholder="分数变化的原因（必填）"
                  value={reason}
                  maxLength={2000}
                  onChange={(e) => setReason(e.target.value)}
                />
                <Button
                  className="primary"
                  disabled={v.busy || !reason.trim()}
                  onClick={async () => {
                    if (await c.act("score", { ...edit, reason })) setEdit(null);
                  }}
                >
                  保存分数并留档
                </Button>
                <Button variant="ghost" onClick={() => setEdit(null)}>
                  取消
                </Button>
              </section>
            )}
            <DisasterCards cards={room.activeDisasters} />
            {v.pending && <p className="muted">神谕处理期间锁定分数，确保裁决依据不变。</p>}
            <Button
              className="wide"
              variant="outline"
              disabled={v.busy || v.pending}
              onClick={() => act("advance")}
            >
              进入下一回合
            </Button>
            <div className="split-actions">
              <Button
                variant="ghost"
                disabled={v.busy}
                onClick={() =>
                  setConfirm({
                    title: "结束并保存本局？",
                    description: "结束后本局只可查看；未确认的奖惩不执行。",
                    action: () => act("finish"),
                  })
                }
              >
                结束本局
              </Button>
              <Button variant="ghost" disabled={v.busy} onClick={leave}>
                暂时退出
              </Button>
            </div>
          </>
        )}
        {v.screen === "report" && oracle && (
          <>
            <Back onClick={() => c.navigate("game")} />
            <div className="eyebrow">03 / 神谕回应</div>
            <h2>{oracle.initialVerdict.title}</h2>
            {oracle.task && (
              <section className="assessment">
                <div className="eyebrow">{oracle.task.category} · 本回合任务</div>
                <h3>{oracle.task.title}</h3>
                <p>{oracle.task.instruction}</p>
                <p className="muted">完成标准：{oracle.task.criteria}</p>
              </section>
            )}
            <p className="muted">
              {oracle.god.name} · {oracle.llm.used ? oracle.llm.model : "本地规则模式"}
            </p>
            <div className="paper">
              <p>{oracle.initialVerdict.statement}</p>
              <ol>
                {oracle.initialVerdict.measures.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ol>
            </div>
            <details className="knowledge">
              <summary>本地 RAG 知识依据 · {oracle.rag.evidence.length} 条</summary>
              {oracle.rag.evidence.map((e) => (
                <p key={e.id}>
                  <strong>{e.title}</strong>
                  <br />
                  {e.content}
                </p>
              ))}
            </details>
            {!oracle.finalVerdict && (
              <>
                <label className="field-label" htmlFor={`${roleId}-report`}>
                  汇报桌面行动
                </label>
                <Textarea
                  id={`${roleId}-report`}
                  value={report}
                  maxLength={2000}
                  onChange={(e) => setReport(e.target.value)}
                  placeholder="请描述谁做了什么、付出了什么、产生了什么结果。"
                  rows={4}
                />
                <Button
                  className="primary"
                  disabled={v.busy || !report.trim()}
                  onClick={() => act("report", { judgmentId: oracle.id, text: report })}
                >
                  提交行动评估
                </Button>
              </>
            )}
            {v.report && (
              <div className="assessment">
                <span className="eyebrow">
                  {v.report.assessment.used ? "AI 行动评估" : "本地规则评估（非 AI）"}
                </span>
                <h3>
                  {v.report.assessment.completed
                    ? "建议判定：已完成"
                    : "建议判定：证据不足 / 未完成"}
                </h3>
                <p>{v.report.assessment.reason}</p>
                <p className="muted">玩家自述：{v.report.text}</p>
              </div>
            )}
            {v.report && !oracle.finalVerdict && (
              <>
                <label className="field-label" htmlFor={`${roleId}-rebut`}>
                  向上帝驳斥 / 补充说明（可选）
                </label>
                <Textarea
                  id={`${roleId}-rebut`}
                  value={rebuttal}
                  maxLength={2000}
                  onChange={(e) => setRebuttal(e.target.value)}
                  placeholder="你是否有不同意见或补救计划？"
                />
                <Button
                  className="primary"
                  disabled={v.busy}
                  onClick={() => act("rebut", { judgmentId: oracle.id, text: rebuttal })}
                >
                  听取最终裁决
                </Button>
              </>
            )}
            {oracle.finalVerdict && (
              <>
                <div className="paper">
                  <div className="eyebrow">
                    最终裁决 · {oracle.llm.final?.used ? "M3" : "本地规则"}
                  </div>
                  <h3>{oracle.finalVerdict.title}</h3>
                  <p>{oracle.finalVerdict.statement}</p>
                  <ol>
                    {oracle.finalVerdict.measures.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ol>
                </div>
                <h3>数值奖惩预览</h3>
                {v.changes.map((change, i) => (
                  <div className="change" key={i}>
                    <span>
                      {change.scopeLabel} · {change.label}
                    </span>
                    <strong>
                      {change.before} → {change.after}
                    </strong>
                  </div>
                ))}
                <p className="muted">
                  试玩规则 tabletop-v1。叙事措施不额外自动改分，只有确认才写入分数变化。
                </p>
                <Button
                  className="primary"
                  disabled={v.busy || !!oracle.settlement}
                  onClick={() => act("settle", { judgmentId: oracle.id })}
                >
                  {oracle.settlement ? "已确认结算" : "确认并结算"}
                </Button>
                <Button className="wide" variant="ghost" onClick={() => c.navigate("game")}>
                  暂不确认，返回游戏
                </Button>
              </>
            )}
          </>
        )}
        {v.screen === "records" && (
          <>
            <Back onClick={() => c.openGame()} />
            <div className="eyebrow">ARCHIVE</div>
            <h2>方舟航行记录</h2>
            <p className="muted">当前游戏与历史游戏，独立保存。</p>
            {listedRooms.map((r) => (
              <article className="room-card" key={r.id}>
                <div>
                  <strong>{r.id}</strong>
                  <span className="pill">{STATUS[r.status]}</span>
                </div>
                <p>
                  第 {r.round} 回合 · {r.judgments.length} 次神谕 · {r.createdAt.slice(0, 10)}
                </p>
                <Button className="wide" variant="outline" onClick={() => void c.detail(r.id)}>
                  查看游戏详情 <ArrowRight size={16} />
                </Button>
              </article>
            ))}
            {!listedRooms.length && <p className="muted">第一段航行还未开始。</p>}
          </>
        )}
        {v.screen === "detail" && room && (
          <>
            <Back onClick={() => c.navigate("records")} />
            <div className="eyebrow">
              {STATUS[room.status]} · 第 {room.round} 回合
            </div>
            <h2>{room.id}</h2>
            <p className="muted">
              {room.createdAt.slice(0, 16).replace("T", " ")} —{" "}
              {room.finishedAt?.slice(0, 16).replace("T", " ") || "进行中"}
            </p>
            <p className="muted">
              {v.seats
                .filter((s) => room.players[s.id])
                .map((s) => s.name)
                .join(" · ")}
            </p>
            {scores(true)}
            <h3>神谕时间线</h3>
            {room.judgments.map((j) => (
              <details className="archive-oracle" key={j.id}>
                <summary>
                  第 {j.round} 回合 · {j.initialVerdict.title}
                  <small>
                    {j.settlement ? "已结算" : "未结算"} · {j.god.name}
                  </small>
                </summary>
                <p>{j.initialVerdict.statement}</p>
                {j.taskReports.map((r) => (
                  <div className="paper" key={r.id}>
                    <p>{r.text}</p>
                    <p>
                      {r.assessment.completed ? "完成" : "未完成 / 证据不足"}：{r.assessment.reason}
                    </p>
                  </div>
                ))}
                {j.playerRebuttal && <p>玩家驳斥：{j.playerRebuttal}</p>}
                {j.finalVerdict && (
                  <p>
                    最终裁决：{j.finalVerdict.statement}
                    <br />
                    {j.finalVerdict.measures.join("；")}
                  </p>
                )}
                <p className="muted">RAG：{j.rag.evidence.map((e) => e.title).join("、")}</p>
              </details>
            ))}
            <h3>全部操作与分数来源</h3>
            <div className="timeline">
              {v.timeline.map((e) => (
                <article key={e.id}>
                  <small>
                    {e.time} · {e.actorName} · 第 {e.round} 回合
                  </small>
                  <p>{e.detail}</p>
                  {e.changesText && <strong>{e.changesText}</strong>}
                </article>
              ))}
            </div>
          </>
        )}
        {v.screen === "finished" && room && (
          <>
            <div className="role-hero">
              <div className="role-seal">
                <Leaf size={38} />
              </div>
              <div className="eyebrow">VOYAGE COMPLETE</div>
              <h2>这一程，已被记住。</h2>
              <p>{room.id} · 已结束并保存</p>
            </div>
            <div className="summary-stats">
              <div>
                <strong>{room.round}</strong>
                <span>回合</span>
              </div>
              <div>
                <strong>{room.judgments.length}</strong>
                <span>神谕</span>
              </div>
              <div>
                <strong>{Object.keys(room.players).length}</strong>
                <span>玩家</span>
              </div>
            </div>
            {scores(true)}
            <Button className="primary" disabled={v.busy} onClick={newGame}>
              开始新的一局
            </Button>
            <Button className="wide" variant="outline" onClick={() => void c.detail(room.id)}>
              查看完整记录
            </Button>
            <Button className="wide" variant="ghost" onClick={leave}>
              退出游戏
            </Button>
          </>
        )}
      </div>
      <nav className="phone-nav" aria-label="游戏导航">
        <Button variant="ghost" onClick={() => setGuideOpen(true)}>
          玩法
        </Button>
        <Button
          variant="ghost"
          disabled={v.busy}
          className={["game", "lobby", "report"].includes(v.screen) ? "active" : ""}
          onClick={() => c.openGame()}
        >
          游戏
        </Button>
        <Button
          variant="ghost"
          className={["records", "detail"].includes(v.screen) ? "active" : ""}
          onClick={() => c.navigate("records")}
        >
          记录
        </Button>
        <Button
          variant="ghost"
          aria-label="刷新房间"
          disabled={v.busy}
          onClick={() => void c.refresh()}
        >
          <RefreshCw size={16} />
        </Button>
      </nav>
      <PlayerGuide open={guideOpen} onOpenChange={setGuideOpen} />
      <AlertDialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirm?.action();
                setConfirm(null);
              }}
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
function Back({ onClick }: { onClick: () => void }) {
  return (
    <Button className="back" variant="ghost" onClick={onClick}>
      <ArrowLeft size={16} /> 返回
    </Button>
  );
}
