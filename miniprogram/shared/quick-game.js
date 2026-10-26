import { createClient } from "./client.js";

export const QUICK_ROLES = ["A01", "A02", "A03", "H01", "H02", "H03"];
export const quickStorageKey = (roleId) => `noah-quick-${roleId}`;
const running = new WeakSet();

// Six real clients, normal APIs, no server bypass or automatic god/LLM calls.
// Dedicated persisted identities keep manual games untouched and make retry resumable.
export async function startQuickGame({ request, storage, onProgress = () => {} }) {
  if (running.has(storage)) throw new Error("测试开局正在进行，请稍候。");
  running.add(storage);
  const clients = [];
  try {
    onProgress("1/4 · 正在连接六个独立测试身份…");
    for (const roleId of QUICK_ROLES)
      clients.push(
        createClient({
          request,
          storage,
          initialRole: roleId,
          storageKey: quickStorageKey(roleId),
        }),
      );
    await Promise.all(clients.map((client) => client.init()));
    if (clients.some((client) => !client.getState().connected))
      throw new Error("无法连接本地服务。请启动服务后再次点击一键测试开局。");
    const active = clients
      .map((client) => client.getState().room)
      .filter((room) => room && room.status !== "finished");
    if (new Set(active.map((room) => room.id)).size > 1)
      throw new Error("测试角色关联了不同的未结束游戏，请先分别结束这些测试局。");
    onProgress("2/4 · 正在安排六个角色进入同一方舟…");
    let room = active[0] || (await clients[0].create());
    if (!room) throw new Error(clients[0].getState().error || "建房失败，请检查连接后重试。");
    const joined = await Promise.all(clients.map((client) => client.join(room.id)));
    if (joined.some((result) => result?.id !== room.id))
      throw new Error("部分测试角色加入失败。再次点击一键测试开局，将继续补齐同一局。");
    room = await request(`/api/rooms/${room.id}`);
    if (room.status === "lobby") {
      onProgress("3/4 · 正在让六位测试玩家准备…");
      const ready = await Promise.all(
        clients.map((client) => client.act("ready", { ready: true })),
      );
      if (ready.some((result) => result?.id !== room.id))
        throw new Error("部分测试玩家准备失败。再次点击一键测试开局，将继续同一局，不会重复建房。");
      onProgress("4/4 · 六人已准备，正在开始游戏…");
      room = await clients[0].act("start");
      if (!room || room.status !== "playing")
        throw new Error("开局尚未确认。再次点击一键测试开局可检查并继续原局。");
    }
    if (room.status !== "playing" || QUICK_ROLES.some((id) => !room.players[id]?.online))
      throw new Error("未能确认六人在线开局，请重试检查。");
    onProgress(`测试局 ${room.id} 已开始 · 六人在线，可手动触发上帝。`);
    return room;
  } finally {
    clients.forEach((client) => client.dispose());
    running.delete(storage);
  }
}
