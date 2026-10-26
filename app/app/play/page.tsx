"use client";
import GamePhone from "@/components/game/game-phone";
import { PLAYER_VERSION } from "../../../miniprogram/shared/player-guide.js";

export default function Play() {
  return (
    <main className="noah player-app">
      <div className="player-edition">
        <span>NOAH’S RESCUE</span>
        <span>本地内测 · {PLAYER_VERSION}</span>
      </div>
      <GamePhone roleId="A03" playerMode />
      <footer className="player-footer">
        <a href="/mobile">开发者六人模拟器 ↗</a>
        <span>记录留在本地 · 请勿填写个人隐私</span>
      </footer>
    </main>
  );
}
