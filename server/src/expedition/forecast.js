import { RESOURCES } from "./catalog.js";
import { bag, sum } from "./runtime.js";
import { arkCapacity } from "./rules.js";

const FLOOD_ROUNDS = [3, 5, 7];
const ARK_OUTCOMES = [
  { resource: "wood", dieValues: [1, 2] },
  { resource: "metal", dieValues: [3, 4] },
  { resource: "electricity", dieValues: [5, 6] },
];

/**
 * Public, inventory-based planning only. The engine injects its authoritative
 * floodCost function so reserve-crate discounts cannot drift from settlement.
 * No random draw is performed or inspected, and the game is never mutated.
 */
export function buildFloodForecast(g, computeCost) {
  const currentEvent = g.events.findLast(
    (event) => event.type === "flood" && event.round === g.round,
  );
  const paidPlayerIds = currentEvent
    ? g.events
        .filter(
          (event) =>
            event.type === "flood_payment" &&
            event.round === g.round &&
            event.seq > currentEvent.seq,
        )
        .map((event) => event.actor)
    : [];
  const current = currentEvent
    ? {
        round: g.round,
        level: g.floodLevel,
        zone: currentEvent.zone,
        die: currentEvent.die,
        resource: currentEvent.resource,
        requested: currentEvent.requested,
        actual: currentEvent.actual,
        paidPlayerIds,
        remainingPlayerIds: g.players
          .filter((p) => !paidPlayerIds.includes(p.id))
          .map((p) => p.id),
      }
    : null;
  const round =
    g.status === "playing"
      ? FLOOD_ROUNDS.find(
          (value, index) => value >= g.round && index + 1 > g.floodLevel,
        )
      : undefined;
  if (round === undefined) return { current, next: null };

  const level = FLOOD_ROUNDS.indexOf(round) + 1;
  // Inherit instead of spreading the game: RNG and hidden checkpoints need not
  // even be read to calculate a forecast.
  const future = Object.assign(Object.create(g), { floodLevel: level });
  const baseCost = structuredClone(
    computeCost(future, { resources: bag(), equipment: [] }),
  );
  const capacity = arkCapacity(g);
  return {
    current,
    next: {
      round,
      level,
      zone: 4 - level,
      roundsUntil: round - g.round,
      baseCost,
      ark: {
        requested: level,
        possibilities: ARK_OUTCOMES.map(({ resource, dieValues }) => {
          const actualLoss = Math.min(g.ark[resource], level);
          return {
            resource,
            dieValues: [...dieValues],
            currentStock: g.ark[resource],
            actualLoss,
            seatsAfter: Math.min(
              capacity.maxSeats,
              Math.floor((capacity.units - actualLoss) / capacity.unitsPerSeat),
            ),
          };
        }),
      },
      players: g.players.map((p) => {
        const cost = structuredClone(computeCost(future, p));
        const mandatoryPayable = bag();
        for (const resource of RESOURCES)
          mandatoryPayable[resource] = Math.min(
            p.resources[resource],
            cost.mandatory[resource],
          );
        const eligibleOptions = cost.optional
          ? cost.choices.filter(
              (resource) => p.resources[resource] > mandatoryPayable[resource],
            )
          : [];
        return {
          playerId: p.id,
          cost,
          mandatoryPayable,
          eligibleOptions,
          injuryIfPaid: Math.max(
            0,
            sum(cost.mandatory) +
              cost.optional -
              sum(mandatoryPayable) -
              (eligibleOptions.length ? cost.optional : 0),
          ),
          protected: p.equipment.includes("reserve-crate"),
        };
      }),
    },
  };
}
