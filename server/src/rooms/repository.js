import { refreshRoomDisasters } from '../catalog.js';

// One Node process owns the file. Transactions serialize only the short read/write
// phase; model calls live in the service and never hold this cross-room lock.
export function createRoomRepository(store) {
  let tail = Promise.resolve();
  const enqueue = (operation) => {
    const job = tail.then(operation);
    tail = job.catch(() => {});
    return job;
  };
  const transact = (operation) =>
    enqueue(async () => {
      const data = await store.read("rooms.json", { schemaVersion: 1, rooms: [] });
      if (data.schemaVersion !== 1 || !Array.isArray(data.rooms))
        throw new Error("不支持的房间存档版本。");
      data.rooms = data.rooms.map(refreshRoomDisasters);
      const result = await operation(data);
      await store.write("rooms.json", data);
      return structuredClone(result);
    });
  return {
    transact,
    list: () =>
      enqueue(async () => {
        const data = await store.read("rooms.json", { schemaVersion: 1, rooms: [] });
        if (data.schemaVersion !== 1 || !Array.isArray(data.rooms))
          throw new Error("不支持的房间存档版本。");
        return data.rooms.map(refreshRoomDisasters);
      }),
  };
}
