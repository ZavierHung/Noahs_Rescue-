// Platform-independent application controller. The native mini program and
// browser simulator share navigation, API orchestration and identity behavior.
export const DIMENSIONS = [
  { key: "economy", label: "经济" },
  { key: "society", label: "社会" },
  { key: "environment", label: "环境" },
];
export const SCOPE_LABELS = { animals: "动物阵营", humans: "人类阵营", world: "世界" };
export function parseRoomCode(value) {
  const code = String(value || "")
    .trim()
    .toUpperCase();
  if (/^[A-F0-9]{8}$/.test(code)) return `GAME-${code}`;
  if (/^GAME-[A-F0-9]{8}$/.test(code)) return code;
  throw new Error("请输入 8 位房间码，或完整的 GAME-XXXXXXXX。");
}
export function parseRoleCode(value) {
  const text = String(value || "").trim();
  const match =
    text.match(/^(A0[123]|H0[123])$/) || text.match(/^noahs-rescue:\/\/role\/(A0[123]|H0[123])$/);
  if (!match) throw new Error("这不是有效的角色卡，请扫描本游戏的角色二维码。");
  return match[1];
}
export function viewOf(state) {
  const {
    clientId: _clientId,
    roleRooms: _roleRooms,
    pendingCreations: _pendingCreations,
    ...visibleState
  } = state;
  const room = state.screen === "detail" ? state.detailRoom : state.room;
  const role = state.roles.find((item) => item.id === state.roleId) || null;
  const latest = room && room.judgments[room.judgments.length - 1];
  const oracle = latest || null;
  const pending = !!(oracle && !oracle.settlement);
  const seats = state.roles.map((item) => ({
    ...item,
    ...(room && room.players[item.id]),
    teamLabel: SCOPE_LABELS[item.team],
  }));
  const scoreGroups = room
    ? Object.keys(SCOPE_LABELS).map((scope) => ({
        scope,
        label: SCOPE_LABELS[scope],
        dimensions: DIMENSIONS.map((dim) => ({
          ...dim,
          value: room.scores[scope][dim.key],
          warning: room.scores[scope][dim.key] <= 6 || room.scores[scope][dim.key] >= 14,
        })),
      }))
    : [];
  return {
    ...visibleState,
    pendingCreate: !!state.pendingCreations?.[state.roleId],
    myRooms: state.rooms.filter(
      (item) => item.id === state.roomId || Object.values(state.roleRooms || {}).includes(item.id),
    ),
    error: state.error || state.connectionError || "",
    room,
    role,
    seats,
    scoreGroups,
    oracle,
    pending,
    readyCount: seats.filter((s) => s.ready && s.online).length,
    me: (room && room.players[state.roleId]) || null,
    report:
      oracle && oracle.taskReports.length
        ? oracle.taskReports[oracle.taskReports.length - 1]
        : null,
    changes:
      oracle && oracle.proposal
        ? oracle.proposal.changes.map((c) => ({
            ...c,
            scopeLabel: SCOPE_LABELS[c.scope],
            label: DIMENSIONS.find((d) => d.key === c.dimension).label,
          }))
        : [],
    timeline: room
      ? room.events
          .slice()
          .reverse()
          .map((e) => ({
            ...e,
            actorName: (state.roles.find((r) => r.id === e.actor) || {}).name || e.actor,
            time: e.at.slice(5, 16).replace("T", " "),
            changesText: e.changes
              .map(
                (c) =>
                  `${SCOPE_LABELS[c.scope]}${DIMENSIONS.find((d) => d.key === c.dimension).label} ${c.before}→${c.after}`,
              )
              .join(" · "),
          }))
      : [],
  };
}

export function createClient({
  request,
  storage,
  storageKey = "noah-player",
  onChange = () => {},
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  initialRole = "A03",
}) {
  const saved = storage.get(storageKey) || {};
  let state = {
    roleId: saved.roleId || initialRole,
    clientId:
      saved.clientId ||
      `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`,
    roomId: saved.roomId || null,
    roleRooms: {
      ...(saved.roleRooms || {}),
      ...(saved.roomId ? { [saved.roleId || initialRole]: saved.roomId } : {}),
    },
    room: null,
    detailRoom: null,
    roles: [],
    rooms: [],
    pendingCreations: saved.pendingCreations || {},
    screen: "role",
    busy: false,
    error: "",
    connectionError: "",
    connected: false,
  };
  let disposed = false;
  let refreshing = false;
  let operationEpoch = 0;
  let navigationEpoch = 0;
  const save = () =>
    storage.set(storageKey, {
      roleId: state.roleId,
      clientId: state.clientId,
      roomId: state.roomId,
      roleRooms: state.roleRooms,
      pendingCreations: state.pendingCreations,
    });
  const emit = (patch) => {
    if (disposed) return;
    state = { ...state, ...patch };
    if (state.roomId) state.roleRooms = { ...state.roleRooms, [state.roleId]: state.roomId };
    save();
    onChange(viewOf(state));
  };
  const who = () => ({ roleId: state.roleId, clientId: state.clientId });
  const location = (room) =>
    room.status === "lobby" ? "lobby" : room.status === "finished" ? "finished" : "game";
  const remember = (rooms, room) => [room, ...rooms.filter((item) => item.id !== room.id)];
  const adopt = (room, navigate = true, extra = {}) => {
    emit({
      ...extra,
      room,
      roomId: room.id,
      rooms: remember(state.rooms, room),
      ...(navigate ? { screen: location(room) } : {}),
    });
    return room;
  };
  const run = async (operation, connection = false) => {
    if (state.busy || disposed) return;
    operationEpoch += 1;
    emit({ busy: true, error: "" });
    try {
      return await operation();
    } catch (error) {
      const message = error.message || "连接失败，请检查本地服务后重试。";
      emit(connection ? { connectionError: message, connected: false } : { error: message });
    } finally {
      emit({ busy: false });
    }
  };
  const refresh = async () => {
    if (state.busy || refreshing || disposed) return;
    refreshing = true;
    const epoch = operationEpoch;
    try {
      let [rooms, roles] = await Promise.all([
        request("/api/rooms"),
        state.roles.length ? state.roles : request("/api/roles"),
      ]);
      if (state.busy || disposed || epoch !== operationEpoch) return;
      // Out-of-order responses must never move a room backwards in time.
      rooms = rooms.map((room) => {
        const known = state.rooms.find((item) => item.id === room.id);
        return known && (known.revision || 0) > (room.revision || 0) ? known : room;
      });
      let room = rooms.find((r) => r.id === state.roomId) || state.room;
      if (
        room &&
        state.room &&
        room.id === state.room.id &&
        (room.revision || 0) < (state.room.revision || 0)
      )
        room = state.room;
      let screen = state.screen;
      if (
        room &&
        state.room &&
        room.status !== state.room.status &&
        ["lobby", "game", "report", "finished"].includes(screen)
      )
        screen = location(room);
      emit({ rooms, room, roles, screen, connected: true, connectionError: "" });
    } catch (error) {
      if (!state.busy && epoch === operationEpoch)
        emit({ connected: false, connectionError: error.message });
    } finally {
      refreshing = false;
    }
  };
  return {
    getState: () => viewOf(state),
    dispose: () => {
      disposed = true;
      operationEpoch += 1;
    },
    async init() {
      await run(async () => {
        const [roles, rooms] = await Promise.all([request("/api/roles"), request("/api/rooms")]);
        emit({
          roles,
          rooms,
          room: rooms.find((r) => r.id === state.roomId) || null,
          connected: true,
          connectionError: "",
        });
      }, true);
    },
    refresh,
    openGame: () => {
      navigationEpoch += 1;
      const room = state.room;
      const me = room && room.players[state.roleId];
      emit({ screen: !room || !me || !me.online ? "role" : location(room), error: "" });
    },
    navigate: (screen) => {
      navigationEpoch += 1;
      emit({ screen, error: "" });
    },
    selectRole: (roleId) => {
      if (!state.busy) {
        operationEpoch += 1;
        navigationEpoch += 1;
        const selected = parseRoleCode(roleId);
        const roomId = state.roleRooms[selected] || null;
        emit({
          roleId: selected,
          roomId,
          room:
            state.rooms.find((room) => room.id === roomId) ||
            (state.room && state.room.id === roomId ? state.room : null),
          screen: "role",
          error: "",
        });
      }
    },
    create: () =>
      run(async () => {
        const nav = navigationEpoch;
        const roleId = state.roleId;
        const pending = state.pendingCreations[roleId] || {
          requestId: `create_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`,
          previousGameId: state.roomId,
        };
        emit({ pendingCreations: { ...state.pendingCreations, [roleId]: pending } });
        try {
          const room = await request("/api/rooms", "POST", { ...who(), ...pending });
          const pendingCreations = { ...state.pendingCreations };
          delete pendingCreations[roleId];
          return adopt(room, nav === navigationEpoch, { pendingCreations });
        } catch (error) {
          // A definite rejection is safe to retry as a new command; a network
          // or server failure remains pending across app reloads.
          if ([400, 403, 404, 409].includes(error.status)) {
            const pendingCreations = { ...state.pendingCreations };
            delete pendingCreations[roleId];
            emit({ pendingCreations });
          }
          throw error;
        }
      }),
    join: (id) =>
      run(async () => {
        const nav = navigationEpoch;
        const room = await request(`/api/rooms/${id}/actions`, "POST", { ...who(), type: "join" });
        return adopt(room, nav === navigationEpoch);
      }),
    detail: (id) =>
      run(async () => {
        const nav = navigationEpoch;
        const detailRoom = await request(`/api/rooms/${id}`);
        emit({ detailRoom, ...(nav === navigationEpoch ? { screen: "detail" } : {}) });
      }),
    async act(type, input = {}) {
      return run(async () => {
        const id = state.roomId;
        const nav = navigationEpoch;
        let result = await request(`/api/rooms/${id}/actions`, "POST", {
          ...input,
          ...who(),
          type,
        });
        if (result.jobId) {
          const deadline = Date.now() + 240000;
          while (true) {
            if (disposed) return;
            if (Date.now() > deadline) throw new Error("等待超时，请刷新查看结果，勿重复提交。");
            await wait(500);
            const job = await request(`/api/room-jobs/${result.jobId}`);
            if (job.status === "failed") throw new Error(job.error);
            if (job.status === "done") {
              result = job.result;
              break;
            }
          }
        }
        let screen = state.screen;
        if (["start", "advance", "settle"].includes(type)) screen = "game";
        if (["trigger", "report", "rebut"].includes(type)) screen = "report";
        if (type === "finish") screen = "finished";
        if (type === "leave") screen = "role";
        emit({
          room: result,
          rooms: remember(state.rooms, result),
          screen: nav === navigationEpoch ? screen : state.screen,
        });
        return result;
      });
    },
  };
}
