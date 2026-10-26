export const ROLES = Object.freeze([
  { id: "A01", name: "耳廓沙狐", team: "animals", badge: "FOX" },
  { id: "A02", name: "金狮绢猴", team: "animals", badge: "MONKEY" },
  { id: "A03", name: "北极熊", team: "animals", badge: "BEAR" },
  { id: "H01", name: "船长", team: "humans", badge: "CAPTAIN" },
  { id: "H02", name: "商人", team: "humans", badge: "TRADER" },
  { id: "H03", name: "猎人", team: "humans", badge: "HUNTER" },
]);
export const DIMENSIONS = ["economy", "society", "environment"];
export const SCOPES = ["animals", "humans", "world"];
export const POLICY = {
  version: "tabletop-v1",
  description:
    "本地试玩规则：奖励=世界环境+1、触发方社会+1；惩罚=世界环境-1、触发方经济-1；混合=世界环境+1、触发方经济-1。每项限1—19，最终以玩家确认的预览为准。",
};
export function fail(message, status = 409) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
export function roleFor(id) {
  return ROLES.find((role) => role.id === id) || fail("无效的角色 ID。", 400);
}
export function identity(input) {
  roleFor(input.roleId);
  if (typeof input.clientId !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(input.clientId))
    fail("缺少本地玩家凭证。", 400);
  return { roleId: input.roleId, clientId: input.clientId };
}
export function textInput(value, label, optional = false) {
  if (optional && !value) return "";
  if (typeof value !== "string" || !value.trim() || value.length > 2000)
    fail(`${label}需为 1—2000 字。`, 400);
  return value.trim();
}
export function blankScores() {
  return Object.fromEntries(
    SCOPES.map((scope) => [scope, { economy: 10, society: 10, environment: 10 }]),
  );
}
export function unsettled(room) {
  return room.judgments.findLast((j) => !j.settlement);
}
export function proposalFor(room, session) {
  const tone = session.finalVerdict.tone;
  const team = roleFor(session.player.id).team;
  const deltas =
    tone === "reward"
      ? [
          ["world", "environment", 1],
          [team, "society", 1],
        ]
      : tone === "penalty"
        ? [
            ["world", "environment", -1],
            [team, "economy", -1],
          ]
        : [
            ["world", "environment", 1],
            [team, "economy", -1],
          ];
  return {
    policy: POLICY.version,
    scoreRevision: room.scoreRevision,
    changes: deltas.map(([scope, dimension, delta]) => {
      const before = room.scores[scope][dimension];
      const after = Math.max(1, Math.min(19, before + delta));
      return { scope, dimension, before, after, delta: after - before };
    }),
  };
}

export function publicRoom(room) {
  const copy = structuredClone(room);
  delete copy.creation;
  for (const player of Object.values(copy.players)) delete player.clientId;
  return copy;
}
