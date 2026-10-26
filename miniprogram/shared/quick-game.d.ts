import type { Room, createClient } from "./client.js";
export const QUICK_ROLES: string[];
export function quickStorageKey(roleId: string): string;
export function startQuickGame(options: {
  request: Parameters<typeof createClient>[0]["request"];
  storage: Parameters<typeof createClient>[0]["storage"];
  onProgress?: (message: string) => void;
}): Promise<Room>;
