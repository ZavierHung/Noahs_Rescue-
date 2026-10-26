// Browser convenience only: every step still uses the normal six player APIs.
export async function prepareParty(clients) {
  if (
    clients.length !== 6 ||
    clients.some((c) => !c || c.getState().busy || !c.getState().connected)
  )
    throw new Error("请等待六个角色连接完成后重试。");
  await Promise.all(clients.map((c) => c.refresh()));
  if (clients.some((c) => !c.getState().connected))
    throw new Error("连接已中断，请恢复本地服务后重试。");
  if (clients.some((c) => c.getState().roomId && c.getState().room?.status !== "finished"))
    throw new Error("有角色仍关联未结束的游戏，请先结束该局，或手动加入已有等待室。");
  const room = await clients[0].create();
  if (!room || room.status !== "lobby")
    throw new Error(clients[0].getState().error || "创建失败，未启动六人准备。");
  const joined = await Promise.all(clients.slice(1).map((c) => c.join(room.id)));
  if (joined.some((result) => result?.id !== room.id))
    throw new Error("部分角色加入失败，请查看各手机的提示，在同一等待室手动补齐。");
  const ready = await Promise.all(clients.map((c) => c.act("ready", { ready: true })));
  if (ready.some((result) => !result || result.id !== room.id))
    throw new Error("部分玩家准备失败，请在各手机中重试“我已准备”，不要重复建房。");
  await Promise.all(clients.map((c) => c.refresh()));
  if (
    clients.some(
      (c) =>
        !c.getState().connected || c.getState().roomId !== room.id || c.getState().readyCount !== 6,
    )
  )
    throw new Error("尚未确认六人全部准备，请刷新等待室检查。");
  return room.id;
}
