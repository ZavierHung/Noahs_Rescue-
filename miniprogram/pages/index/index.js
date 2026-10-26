import { API_BASE } from "../../config";
import { createClient, parseRoleCode, parseRoomCode } from "../../shared/client";
import { startQuickGame, quickStorageKey } from "../../shared/quick-game";
import { PLAYER_GUIDE, PLAYER_NOTICE, PLAYER_VERSION } from "../../shared/player-guide";

const storage = {
  get: (key) => wx.getStorageSync(key) || null,
  set: (key, value) => wx.setStorageSync(key, value),
};

function request(path, method = "GET", data) {
  return new Promise((resolve, reject) =>
    wx.request({
      url: API_BASE + path,
      method,
      data,
      timeout: 15000,
      header: { "content-type": "application/json" },
      success: (res) =>
        res.statusCode >= 200 && res.statusCode < 300
          ? resolve(res.data)
          : reject(
              Object.assign(new Error(res.data.error || "本地服务请求失败。"), {
                status: res.statusCode,
              }),
            ),
      fail: () =>
        reject(
          new Error("无法连接本地服务，请确认 API 已启动，并在开发者工具中关闭合法域名校验。"),
        ),
    }),
  );
}
Page({
  data: {
    roles: [],
    rooms: [],
    seats: [],
    screen: "role",
    roleId: "A03",
    room: null,
    oracle: null,
    busy: false,
    error: "",
    connected: false,
    reportText: "",
    rebuttalText: "",
    edit: null,
    reason: "",
    preparing: false,
    quickMessage: "",
    testMode: false,
    roomCode: "",
    showGuide: false,
    guide: PLAYER_GUIDE,
    playerNotice: PLAYER_NOTICE,
    playerVersion: PLAYER_VERSION,
  },
  attachClient(testMode = false, roleId = "A03") {
    if (this.client) this.client.dispose();
    this.client = createClient({
      request,
      storage,
      storageKey: testMode ? quickStorageKey(roleId) : "noah-player",
      initialRole: roleId,
      onChange: (view) => {
        const identityChanged =
          this.data.roleId !== view.roleId || this.data.roomId !== view.roomId;
        if (identityChanged || this.data.oracle?.id !== view.oracle?.id)
          this.setData({ reportText: "", rebuttalText: "" });
        if (
          identityChanged ||
          this.data.pending !== view.pending ||
          this.data.room?.status !== view.room?.status
        )
          this.setData({ edit: null, reason: "" });
        if (!this.closed)
          this.setData({
            ...view,
            rooms: testMode ? view.rooms : view.myRooms,
            busy: view.busy || this.data.preparing,
          });
      },
    });
    this.setData({ testMode });
  },
  onLoad(options) {
    this.attachClient();
    if (options.role) {
      try {
        this.client.selectRole(parseRoleCode(decodeURIComponent(options.role)));
      } catch (error) {
        this.setData({ error: error.message });
      }
    }
    this.client.init();
  },
  async quickStart() {
    if (this.data.preparing || this.data.busy) return;
    const roleId = this.data.roleId;
    this.setData({ preparing: true, busy: true, error: "" });
    // Stop the visible test controller from overwriting its identity's new room
    // while the short-lived six-player setup clients run.
    const wasTestMode = this.data.testMode;
    if (wasTestMode) this.client.dispose();
    try {
      await startQuickGame({
        request,
        storage,
        onProgress: (quickMessage) => {
          if (!this.closed) this.setData({ quickMessage });
        },
      });
      if (this.closed) return;
      this.attachClient(true, roleId);
      await this.client.init();
      this.client.openGame();
    } catch (error) {
      if (this.closed) return;
      if (wasTestMode) {
        this.attachClient(true, roleId);
        await this.client.init();
      }
      this.setData({ quickMessage: error.message });
    } finally {
      if (!this.closed) this.setData({ preparing: false, busy: this.client.getState().busy });
    }
  },
  async manualMode() {
    if (this.data.busy) return;
    this.attachClient(false);
    await this.client.init();
    this.client.openGame();
    this.setData({ quickMessage: "已返回手动身份，原游戏与测试局均保留。" });
  },
  onShow() {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.client && this.client.refresh(), 2000);
  },
  onHide() {
    clearInterval(this.timer);
  },
  onUnload() {
    this.closed = true;
    clearInterval(this.timer);
    this.client.dispose();
  },
  async onPullDownRefresh() {
    await this.client.refresh();
    wx.stopPullDownRefresh();
  },
  retry() {
    this.client.init();
  },
  toggleGuide() {
    this.setData({ showGuide: !this.data.showGuide });
  },
  previewDisaster(event) {
    const cards = this.data.room?.activeDisasters || [];
    const card = cards.find((item) => item.id === event.currentTarget.dataset.id);
    if (!card?.image) return;
    wx.previewImage({
      current: `/assets/disasters/${card.image.file}`,
      urls: cards.filter((item) => item.image).map((item) => `/assets/disasters/${item.image.file}`),
      fail: () => wx.showToast({ title: "卡图暂不可用，请查看效果说明", icon: "none" }),
    });
  },
  roomCodeInput(event) {
    this.setData({ roomCode: event.detail.value });
  },
  async joinCode() {
    try {
      return await this.client.join(parseRoomCode(this.data.roomCode));
    } catch (error) {
      this.setData({ error: error.message });
    }
  },
  copyRoomCode() {
    wx.setClipboardData({
      data: this.data.room.id.slice(5),
      fail: () => wx.showToast({ title: "请长按房间码复制", icon: "none" }),
    });
  },
  retryCreate() {
    return this.client.create();
  },
  navigate(event) {
    this.client.navigate(event.currentTarget.dataset.screen);
  },
  gameTab() {
    this.client.openGame();
  },
  async selectRole(event) {
    const id = event.currentTarget.dataset.id;
    if (this.data.testMode) {
      this.attachClient(true, id);
      await this.client.init();
      this.client.openGame();
    } else this.client.selectRole(id);
  },
  scan() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ["qrCode"],
      success: (res) => {
        try {
          this.client.selectRole(parseRoleCode(res.result));
        } catch (error) {
          this.setData({ error: error.message });
        }
      },
      fail: () => wx.showToast({ title: "未读取角色卡", icon: "none" }),
    });
  },
  async confirm(title, content, action) {
    const result = await new Promise((resolve) =>
      wx.showModal({ title, content, success: resolve }),
    );
    if (result.confirm) await action();
  },
  create() {
    if (this.data.pendingCreate) return this.client.create();
    if (this.data.roomId)
      this.confirm("创建下一局？", "原局归档，未确认的奖惩不执行。六个角色需要重新加入。", () =>
        this.client.create(),
      );
    else this.client.create();
  },
  join(event) {
    this.client.join(event.currentTarget.dataset.id);
  },
  ready() {
    this.client.act("ready", { ready: !this.data.me.ready });
  },
  start() {
    this.client.act("start");
  },
  trigger() {
    this.data.pending ? this.client.navigate("report") : this.client.act("trigger");
  },
  advance() {
    this.client.act("advance");
  },
  leave() {
    this.confirm(
      "暂时离开？",
      "记录不会删除，席位保留。同一设备选择此角色并加入原局即可重连。",
      () => this.client.act("leave"),
    );
  },
  finish() {
    this.confirm("结束本局？", "保存全部已确认分数与交互，未确认奖惩不执行。结束后只可查看。", () =>
      this.client.act("finish"),
    );
  },
  reportInput(event) {
    this.setData({ reportText: event.detail.value });
  },
  rebutInput(event) {
    this.setData({ rebuttalText: event.detail.value });
  },
  report() {
    this.client.act("report", { judgmentId: this.data.oracle.id, text: this.data.reportText });
  },
  rebut() {
    this.client.act("rebut", { judgmentId: this.data.oracle.id, text: this.data.rebuttalText });
  },
  settle() {
    this.client.act("settle", { judgmentId: this.data.oracle.id });
  },
  detail(event) {
    this.client.detail(event.currentTarget.dataset.id);
  },
  editScore(event) {
    const data = event.currentTarget.dataset;
    this.setData({
      edit: {
        scope: data.scope,
        dimension: data.dimension,
        label: data.label,
        value: Number(data.value),
        scoreRevision: this.data.room.scoreRevision,
      },
      reason: "",
    });
  },
  scoreInput(event) {
    this.setData({ "edit.value": Number(event.detail.value) });
  },
  reasonInput(event) {
    this.setData({ reason: event.detail.value });
  },
  cancelEdit() {
    this.setData({ edit: null });
  },
  async saveScore() {
    if (await this.client.act("score", { ...this.data.edit, reason: this.data.reason }))
      this.setData({ edit: null });
  },
});
