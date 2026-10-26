const API = process.env.NEXT_PUBLIC_GAME_API_URL || 'http://localhost:8787';
export async function request(path: string, method = 'GET', data?: unknown) {
  let res: Response;
  try {
    res = await fetch(API + path, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(data ? { body: JSON.stringify(data) } : {}),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(
      '连接中断或等待超时。已保存的记录不会丢失，请恢复连接后重试。',
    );
  }
  let result;
  try {
    result = await res.json();
  } catch {
    throw new Error('服务返回异常，请稍后刷新。不要重复提交尚未确认的操作。');
  }
  if (!res.ok)
    throw Object.assign(
      new Error(
        (result as { error?: string }).error || '服务暂时不可用，请重试。',
      ),
      { status: res.status },
    );
  return result;
}
export const storage = {
  get(key: string) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    localStorage.setItem(key, JSON.stringify(value));
  },
};
