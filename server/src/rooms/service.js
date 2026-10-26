import { createHash, randomUUID } from "node:crypto";
import { resolveDisasters } from "../catalog.js";
import {
  ROLES,
  POLICY,
  SCOPES,
  DIMENSIONS,
  blankScores,
  fail,
  identity,
  roleFor,
  textInput,
  unsettled,
  proposalFor,
  publicRoom,
} from "./rules.js";

export function createRoomService({
  repository,
  agentLoop,
  assessTask,
  taskCatalog,
  now = () => new Date().toISOString(),
}) {
  const queues = new Map();
  const serial = (id, operation) => {
    const previous = queues.get(id) || Promise.resolve();
    const job = previous.catch(() => {}).then(operation);
    queues.set(id, job);
    job
      .finally(() => {
        if (queues.get(id) === job) queues.delete(id);
      })
      .catch(() => {});
    return job;
  };
  const event = (room, actor, type, detail, changes = []) =>
    room.events.push({
      id: randomUUID(),
      at: now(),
      round: room.round,
      actor,
      type,
      detail,
      changes,
    });
  const find = (data, id) => data.rooms.find((room) => room.id === id) || fail("未找到游戏。", 404);
  const member = (room, input) => {
    identity(input);
    const player = room.players[input.roleId];
    if (!player || player.clientId !== input.clientId)
      fail("该角色不属于当前本地玩家，请从角色入口加入。", 403);
    if (!player.online) fail("你已离开，请先重新加入。", 403);
    return player;
  };
  const bump = (room) => {
    room.revision += 1;
    room.updatedAt = now();
  };
  const playing = (room) => {
    if (room.status !== "playing") fail("游戏尚未开始或已经结束。");
  };
  const noOracle = (room) => {
    if (unsettled(room)) fail("请先完成当前神谕的裁决与确认结算。");
  };

  async function aiAction(id, input) {
    // Validate and snapshot, release the repository before calling the model.
    const room =
      (await repository.list()).find((item) => item.id === id) || fail("未找到游戏。", 404);
    member(room, input);
    playing(room);
    let session;
    let detail;
    if (input.type === "trigger") {
      noOracle(room);
      const task = await taskCatalog.choose(room);
      session = await agentLoop.start(
        {
          round: room.round,
          attributes: structuredClone(room.scores.world),
          activeDisasters: room.activeDisasters,
          gameId: room.id,
          teamScores: { animals: room.scores.animals, humans: room.scores.humans },
          players: publicRoom(room).players,
          recentActions: room.events.slice(-20),
          settlementPolicy: POLICY,
          tabletopTask: task,
        },
        { id: input.roleId, name: roleFor(input.roleId).name },
      );
      session.round = room.round;
      session.task = task;
      session.taskReports = [];
      detail = `${session.god.name}降临：${session.initialVerdict.title}`;
    } else {
      session = unsettled(room);
      if (!session || session.id !== input.judgmentId) fail("神谕已更新，请刷新后重试。");
      if (session.status !== "awaiting_rebuttal") fail("最终裁决已生成，不能重复提交。");
      session = structuredClone(session);
      if (input.type === "report") {
        const text = textInput(input.text, "行动汇报");
        const assessment = await assessTask(session, text);
        session.taskReports.push({
          id: randomUUID(),
          roleId: input.roleId,
          text,
          assessment,
          at: now(),
        });
        detail = `${roleFor(input.roleId).name}提交行动：${text}`;
      } else {
        if (!session.taskReports.length) fail("请先汇报实际行动，再请求最终裁决。");
        const rebuttal = textInput(input.text, "驳斥内容", true);
        const text = `玩家行动记录：${JSON.stringify(session.taskReports)}\n玩家驳斥：${rebuttal || "无补充驳斥，请根据行动记录给出最终奖惩。"}`;
        session = await agentLoop.rebut(session, text);
        session.playerRebuttal = rebuttal;
        session.proposal = proposalFor(room, session);
        detail = `最终裁决已生成，等待玩家确认：${session.finalVerdict.title}`;
      }
    }
    return repository.transact((data) => {
      const current = find(data, id);
      if (current.revision !== room.revision) fail("游戏已被修改，请重新提交。");
      if (input.type === "trigger") current.judgments.push(session);
      else current.judgments[current.judgments.findIndex((j) => j.id === session.id)] = session;
      event(current, input.roleId, input.type, detail);
      bump(current);
      return publicRoom(current);
    });
  }

  return {
    roles: ROLES,
    async list() {
      return (await repository.list()).toReversed().map(publicRoom);
    },
    async get(id) {
      return publicRoom(
        (await repository.list()).find((room) => room.id === id) || fail("未找到游戏。", 404),
      );
    },
    async create(input) {
      identity(input);
      if (
        input.requestId !== undefined &&
        (typeof input.requestId !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(input.requestId))
      )
        fail("无效的建房请求编号。", 400);
      const creationKey = input.requestId
        ? createHash("sha256")
            .update(JSON.stringify([input.clientId, input.requestId]))
            .digest("hex")
        : null;
      // Creating a successor is atomic with archiving its predecessor.
      return serial(input.previousGameId || "create", () =>
        repository.transact((data) => {
          // Replay before any predecessor mutation. Persist with the room so a
          // lost response or server restart cannot create/finish a second game.
          const existing =
            creationKey && data.rooms.find((room) => room.creation?.key === creationKey);
          if (existing) {
            if (
              existing.creation.roleId !== input.roleId ||
              existing.creation.previousGameId !== (input.previousGameId || null)
            )
              fail("同一建房请求不能修改角色或前一局，请刷新核实。", 409);
            return publicRoom(existing);
          }
          if (input.previousGameId) {
            const old = find(data, input.previousGameId);
            const player = old.players[input.roleId];
            if (!player || player.clientId !== input.clientId)
              fail("只能从自己参与的游戏创建下一局。", 403);
            if (old.status !== "finished") {
              old.status = "finished";
              old.finishedAt = now();
              event(old, input.roleId, "finish", "创建新局，原局归档；未确认的奖惩不执行。");
              bump(old);
            }
          }
          const room = {
            schemaVersion: 1,
            id: `GAME-${randomUUID().slice(0, 8).toUpperCase()}`,
            status: "lobby",
            revision: 1,
            scoreRevision: 0,
            createdAt: now(),
            updatedAt: now(),
            finishedAt: null,
            round: 1,
            players: {},
            scores: blankScores(),
            activeDisasters: [],
            judgments: [],
            events: [],
            ...(creationKey
              ? {
                  creation: {
                    key: creationKey,
                    roleId: input.roleId,
                    previousGameId: input.previousGameId || null,
                  },
                }
              : {}),
          };
          room.players[input.roleId] = {
            ...identity(input),
            ready: false,
            online: true,
            joinedAt: now(),
          };
          event(room, input.roleId, "create", "创建等待室");
          data.rooms.push(room);
          return publicRoom(room);
        }),
      );
    },
    async action(id, input) {
      identity(input);
      return serial(id, async () => {
        if (["trigger", "report", "rebut"].includes(input.type)) return aiAction(id, input);
        return repository.transact((data) => {
          const room = find(data, id);
          if (input.type === "join") {
            if (room.status === "finished") fail("该局已结束，可以查看记录或创建新局。");
            const seat = room.players[input.roleId];
            if (seat && seat.clientId !== input.clientId) fail("该角色已被另一位玩家占用。");
            if (!seat && room.status !== "lobby") fail("游戏已开始，不能新增玩家。");
            room.players[input.roleId] = seat
              ? { ...seat, online: true }
              : { ...identity(input), online: true, ready: false, joinedAt: now() };
            event(
              room,
              input.roleId,
              seat ? "reconnect" : "join",
              seat ? "角色重连，保留原游戏状态" : "加入等待室",
            );
          } else {
            member(room, input);
            if (room.status === "finished" && input.type !== "leave")
              fail("游戏已结束，记录只读。");
            if (input.type === "ready") {
              if (room.status !== "lobby" || typeof input.ready !== "boolean")
                fail("只能在等待室设置准备状态。");
              room.players[input.roleId].ready = input.ready;
              event(room, input.roleId, "ready", input.ready ? "已准备" : "取消准备");
            } else if (input.type === "start") {
              if (
                room.status !== "lobby" ||
                ROLES.some(
                  (role) => !room.players[role.id]?.ready || !room.players[role.id]?.online,
                )
              )
                fail("需要六个角色全部在线并准备后才能开始。");
              room.status = "playing";
              event(room, input.roleId, "start", "六人准备完毕，游戏开始");
            } else if (input.type === "score") {
              playing(room);
              noOracle(room);
              if (input.scoreRevision !== room.scoreRevision)
                fail("分数已经变化，请刷新后重新调整。");
              if (
                !SCOPES.includes(input.scope) ||
                !DIMENSIONS.includes(input.dimension) ||
                !Number.isInteger(input.value) ||
                input.value < 1 ||
                input.value > 19
              )
                fail("分数必须为 1—19 的整数，且属于有效阵营和维度。", 400);
              const reason = textInput(input.reason, "调整原因");
              const before = room.scores[input.scope][input.dimension];
              room.scores[input.scope][input.dimension] = input.value;
              room.scoreRevision += 1;
              room.activeDisasters = resolveDisasters(room.scores.world, room.activeDisasters);
              event(room, input.roleId, "score", reason, [
                {
                  scope: input.scope,
                  dimension: input.dimension,
                  before,
                  after: input.value,
                  delta: input.value - before,
                },
              ]);
            } else if (input.type === "settle") {
              playing(room);
              const session = room.judgments.find((j) => j.id === input.judgmentId);
              if (!session?.proposal) fail("尚无可确认的奖惩方案。");
              if (session.settlement) return publicRoom(room); // Idempotent, even across restarts.
              if (session.proposal.scoreRevision !== room.scoreRevision)
                fail("分数已经变化，当前奖惩预览已过期。");
              for (const change of session.proposal.changes)
                room.scores[change.scope][change.dimension] = change.after;
              room.scoreRevision += 1;
              session.settlement = {
                at: now(),
                roleId: input.roleId,
                changes: session.proposal.changes,
              };
              room.activeDisasters = resolveDisasters(room.scores.world, room.activeDisasters);
              event(
                room,
                input.roleId,
                "settle",
                `已确认：${session.finalVerdict.title}`,
                session.proposal.changes,
              );
            } else if (input.type === "advance") {
              playing(room);
              noOracle(room);
              room.round += 1;
              event(room, input.roleId, "advance", `进入第 ${room.round} 回合`);
            } else if (input.type === "finish") {
              room.status = "finished";
              room.finishedAt = now();
              event(room, input.roleId, "finish", "本局结束，完整归档；未确认的奖惩不执行。");
            } else if (input.type === "leave") {
              room.players[input.roleId].online = false;
              if (room.status === "lobby") room.players[input.roleId].ready = false;
              event(room, input.roleId, "leave", "角色离线，保留席位与存档");
            } else fail("不支持的操作。", 400);
          }
          bump(room);
          return publicRoom(room);
        });
      });
    },
  };
}
