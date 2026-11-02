"use client";

import type { Game, Resource } from "@/lib/expedition";
import { ResourceAmount, ResourceBag, ResourceIcon } from "./resources";
import "./voyage-hud.css";

export function VoyageHud({ game: g }: { game: Game }) {
  const forecast = g.floodForecast;
  const capacity = g.capacity;
  const full = capacity.seats >= capacity.maxSeats;
  const intervalProgress = full
    ? capacity.unitsPerSeat
    : capacity.unitsPerSeat - capacity.nextSeatNeeds;
  const next = forecast?.next;
  const current = forecast?.current;
  const risk = next?.players.filter((p) => p.injuryIfPaid > 0).length || 0;

  return (
    <section className="voyage-hud" aria-label="方舟载客与洪水预告">
      <article className="voyage-capacity" aria-label="方舟载客进度">
        <div className="voyage-heading">
          <span className="voyage-emblem" aria-hidden="true">
            ⚓
          </span>
          <div>
            <p className="voyage-kicker">ARK CAPACITY</p>
            <h2>方舟目前可载</h2>
          </div>
          <span className="voyage-capacity-number">
            <b aria-label="当前载客人数">{capacity.seats}</b> 人
          </span>
        </div>
        <p className="voyage-next-seat" aria-live="polite">
          {full ? (
            <strong>已达本局上限 · {capacity.maxSeats} 人</strong>
          ) : (
            <>
              再捐 <strong>{capacity.nextSeatNeeds} 份物资</strong>
              <span>可增至 {capacity.seats + 1} 人</span>
            </>
          )}
        </p>
        <div
          className="voyage-progress"
          role="progressbar"
          aria-label={full ? "方舟已满额" : "下一席位物资进度"}
          aria-valuemin={0}
          aria-valuemax={capacity.unitsPerSeat}
          aria-valuenow={intervalProgress}
          aria-valuetext={
            full
              ? `已达 ${capacity.maxSeats} 人上限`
              : `下一席已积累 ${intervalProgress} / ${capacity.unitsPerSeat} 份，还差 ${capacity.nextSeatNeeds} 份`
          }
        >
          <span
            style={{
              width: `${(intervalProgress / capacity.unitsPerSeat) * 100}%`,
            }}
          />
        </div>
        <p className="voyage-caption">
          共 {capacity.units} 份 · 每 {capacity.unitsPerSeat} 份增加 1 席
          {!full && ` · 下一席 ${intervalProgress}/${capacity.unitsPerSeat}`}
        </p>
        <ResourceBag value={g.ark} />
        <p className="voyage-caption">
          四类物资均计容量；洪水可减席位，容量不保证个人登船。
        </p>
      </article>

      <article
        className={`voyage-flood ${next?.roundsUntil === 0 ? "is-imminent" : ""}`}
        aria-label="洪水准备预告"
      >
        {current && (
          <div className="voyage-current-flood" role="status">
            <strong>第 {current.round} 轮洪水正在结算</strong>
            <span>
              方舟已扣{" "}
              <ResourceAmount
                resource={current.resource as Resource}
                amount={current.actual}
              />
              （骰 {current.die}；应扣 {current.requested} 份），不会重复扣除。
            </span>
            <small>
              {current.remainingPlayerIds.length
                ? `已缴 ${current.paidPlayerIds.length}/${g.players.length} 人，待缴：${current.remainingPlayerIds.join("、")}`
                : "所有玩家已缴纳；请完成剩余逃生或灾难选择。"}
            </small>
          </div>
        )}
        <div className="voyage-heading">
          <span className="voyage-emblem" aria-hidden="true">
            ≋
          </span>
          <div>
            <p className="voyage-kicker">FLOOD FORECAST</p>
            <h2>
              {!forecast
                ? "洪水预告暂不可用"
                : next
                  ? `下一次洪水 · 第 ${next.round} 轮结束`
                  : "本局无下一次洪水"}
            </h2>
          </div>
          {next && (
            <span
              className={`voyage-countdown ${next.roundsUntil === 0 ? "is-urgent" : ""}`}
            >
              {next.roundsUntil === 0
                ? "本轮末到来"
                : `距触发轮 ${next.roundsUntil} 轮`}
            </span>
          )}
        </div>
        {next ? (
          <>
            <div className="voyage-flood-costs">
              <div aria-label="下次洪水个人基础缴纳">
                <h3>每位玩家缴纳</h3>
                <div className="voyage-cost-line">
                  <span>固定</span>
                  <ResourceBag value={next.baseCost.mandatory} hideZero />
                </div>
                <div className="voyage-cost-line">
                  <span>另选 1 份</span>
                  <span className="voyage-choice-resources">
                    {next.baseCost.choices.map((resource) => (
                      <ResourceIcon key={resource} resource={resource} />
                    ))}
                  </span>
                </div>
                <p className="voyage-caption">
                  先固定扣，再选扣；储备仓因人减免。欠缴每份 +1 伤势。
                </p>
              </div>
              <div aria-label="下次洪水方舟扣除">
                <h3>方舟随机扣 {next.ark.requested} 份</h3>
                <p className="voyage-caption">
                  只掷 1 次，仅扣一种；不足按现库扣。
                </p>
                <div className="voyage-die-options">
                  {next.ark.possibilities.map((outcome) => (
                    <div key={outcome.resource}>
                      <span>骰 {outcome.dieValues.join("/")}</span>
                      <ResourceAmount
                        resource={outcome.resource}
                        amount={next.ark.requested}
                      />
                      <small>现库可扣 {outcome.actualLoss} 份</small>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="voyage-warning-row">
              <span>淹没 Zone {next.zone}；外侧区域持续淹没</span>
              {!!risk && <strong>{risk} 人按现有库存有欠缴风险</strong>}
              {next.ark.possibilities.some(
                (p) => p.seatsAfter < capacity.seats,
              ) && (
                <strong>
                  方舟席位可能降至{" "}
                  {Math.min(...next.ark.possibilities.map((p) => p.seatsAfter))}{" "}
                  人
                </strong>
              )}
            </div>
            <details className="voyage-personal-forecast">
              <summary>查看每位玩家准备情况（含储备仓减免）</summary>
              <p className="voyage-caption">
                仅按此刻库存预估，不预知骰子；尚未完成的本次缴纳和后续行动都会改变结果。
              </p>
              <div className="voyage-personal-grid">
                {next.players.map((preview) => (
                  <div
                    key={preview.playerId}
                    className={
                      preview.injuryIfPaid ? "has-shortfall" : "is-prepared"
                    }
                  >
                    <strong>
                      {preview.playerId} ·{" "}
                      {g.players.find((p) => p.id === preview.playerId)?.name}
                    </strong>
                    <span>
                      固定应缴{" "}
                      <ResourceBag value={preview.cost.mandatory} hideZero />
                    </span>
                    <span>
                      {preview.cost.optional ? "另选 1 份：" : "免额外选扣"}
                      {!!preview.cost.optional &&
                        preview.cost.choices.map((r) => (
                          <ResourceIcon key={r} resource={r} />
                        ))}
                    </span>
                    <b>
                      {preview.injuryIfPaid
                        ? `预计欠缴伤势 +${preview.injuryIfPaid}`
                        : "现有物资足以缴纳"}
                    </b>
                    {preview.protected && (
                      <small>储备仓已按实际可支付物资计算减免</small>
                    )}
                  </div>
                ))}
              </div>
            </details>
          </>
        ) : (
          <p className="voyage-flood-done">
            {!forecast
              ? "请刷新获取洪水预告；当前缺少预告数据，不代表本局没有洪水。"
              : current
                ? "这是本局最后一次洪水。先完成本次结算，再准备最终撤离与登船讨论。"
                : "洪水预告已结束。请关注安全地块、个人伤势与最终登船讨论。"}
          </p>
        )}
      </article>
    </section>
  );
}
