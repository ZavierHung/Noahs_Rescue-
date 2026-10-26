"use client";
import { useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Client } from "../../../miniprogram/shared/client.js";
import { prepareParty } from "../../../miniprogram/shared/party.js";
import { startQuickGame } from "../../../miniprogram/shared/quick-game.js";
import { request, storage } from "@/lib/game-transport";
import Phone from "@/components/game/game-phone";
import "./mobile.css";
const IDS = ["A01", "A02", "A03", "H01", "H02", "H03"];
const NAMES = ["耳廓沙狐", "金狮绢猴", "北极熊", "船长", "商人", "猎人"];

export default function Mobile() {
  const [multiple, setMultiple] = useState(false),
    [role, setRole] = useState("A03");
  const [preparing, setPreparing] = useState(false),
    [message, setMessage] = useState("");
  const [testMode, setTestMode] = useState(false);
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const launching = useRef(false);
  const clients = useRef<Record<string, Client>>({});
  const register = useRef((id: string, client: Client | null) => {
    if (client) clients.current[id] = client;
    else delete clients.current[id];
  }).current;
  const quickStart = async () => {
    if (launching.current) return;
    launching.current = true;
    setPreparing(true);
    try {
      await startQuickGame({ request, storage, onProgress: setMessage });
      setTestMode(true);
      setMultiple(true);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      launching.current = false;
      setPreparing(false);
    }
  };
  const prepare = async () => {
    setPreparing(true);
    setMessage("正在使用六个独立玩家身份创建等待室…");
    try {
      const id = await prepareParty(IDS.map((id) => clients.current[id]));
      setMessage(`已创建 ${id}，六人准备完成。任选一个手机点击“开始游戏”。`);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setPreparing(false);
    }
  };
  return (
    <main className="noah simulator">
      <aside className="sim-toolbar">
        <div>
          <small>LOCAL PLAYTEST / 本地多人模拟器</small>
          <h1>六人，一艘方舟。</h1>
          <p>{testMode ? "测试身份 · 可逐个操作六位玩家" : "手动游戏 · 可切换角色或六人同屏"}</p>
        </div>
        <div className="toolbar-actions">
          <Button disabled={preparing || !interactive} onClick={() => void quickStart()}>
            {preparing ? "正在安排玩家…" : "一键测试开局"}
          </Button>
          <Button
            variant="outline"
            disabled={preparing || !interactive}
            onClick={() => setMultiple(!multiple)}
          >
            <Users size={16} />
            {multiple ? "切回单人手机" : "六人同屏模拟"}
          </Button>
          {multiple && !testMode && (
            <Button disabled={preparing} onClick={() => void prepare()}>
              一键建房并准备六人
            </Button>
          )}
          {testMode && (
            <Button
              variant="outline"
              disabled={preparing || !interactive}
              onClick={() => {
                setTestMode(false);
                setMessage("已返回手动身份，测试局与手动游戏均保留。");
              }}
            >
              返回手动游戏
            </Button>
          )}
          <a href="/">原有世界平衡台 ↗</a>
          <a href="/play">玩家入口 ↗</a>
        </div>
      </aside>
      <p className="quick-hint">
        一键安排六个测试角色、全部准备并开局；再次点击继续未结束的测试局。测试局也会留档，不会覆盖手动游戏。
      </p>
      {message && (
        <p className="sim-message" role="status">
          {message}
        </p>
      )}
      {!multiple && (
        <div className="role-switch" aria-label="模拟玩家选择">
          {IDS.map((id, i) => (
            <Button
              variant="outline"
              key={id}
              className={id === role ? "selected" : ""}
              disabled={preparing}
              onClick={() => setRole(id)}
            >
              {NAMES[i]} <small>{id}</small>
            </Button>
          ))}
        </div>
      )}
      <div className={multiple ? "phone-grid" : ""}>
        {(preparing && testMode ? [] : multiple ? IDS : [role]).map((id) => (
          <Phone key={`${testMode}-${id}`} roleId={id} register={register} testMode={testMode} />
        ))}
      </div>
    </main>
  );
}
