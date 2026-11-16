export const RESOURCES = ['wood', 'brick', 'wool', 'grain', 'ore'];
export const emptyCards = () => Object.fromEntries(RESOURCES.map(r => [r, 0]));
export const DEFAULT_RULES = {
  targetPoints: 10, bankTradeRatio: 4, discardLimit: 7,
  futuresEnabled: true, tradeOnAnyTurn: true, preserveRoadConnections: true,
  // Provisional house-rule price: change it before starting a room.
  renovationCost: { brick: 1 },
  costs: {
    road: { wood: 1, brick: 1 },
    settlement: { wood: 1, brick: 1, wool: 1, grain: 1 },
    city: { grain: 2, ore: 3 },
    development: { wool: 1, grain: 1, ore: 1 }
  }
};
export function checkedCards(value = {}, max = 100) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected resource amounts.');
  const result = emptyCards();
  for (const [r, n] of Object.entries(value)) {
    if (!RESOURCES.includes(r) || !Number.isSafeInteger(n) || n < 0 || n > max) throw Error('Invalid resource amount.');
    result[r] = n;
  }
  return result;
}
export function validateRules(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid rule pack.');
  for (const key of Object.keys(input)) if (!Object.hasOwn(DEFAULT_RULES,key)) throw Error('Unknown rule: ' + key);
  const r = structuredClone(DEFAULT_RULES);
  for (const key of ['targetPoints', 'bankTradeRatio', 'discardLimit']) {
    if (input[key] !== undefined) r[key] = input[key];
    const [min, max] = key === 'targetPoints' ? [3, 30] : key === 'bankTradeRatio' ? [2, 8] : [0, 50];
    if (!Number.isInteger(r[key]) || r[key] < min || r[key] > max) throw Error('Invalid ' + key + '.');
  }
  for (const key of ['futuresEnabled', 'tradeOnAnyTurn', 'preserveRoadConnections']) {
    if (input[key] !== undefined) r[key] = input[key];
    if (typeof r[key] !== 'boolean') throw Error('Invalid ' + key + '.');
  }
  if (input.renovationCost !== undefined) r.renovationCost = checkedCards(input.renovationCost, 20);
  if (input.costs !== undefined) {
    if (!input.costs || typeof input.costs !== 'object' || Array.isArray(input.costs)) throw Error('Invalid build costs.');
    for (const [key, cost] of Object.entries(input.costs)) {
      if (!Object.hasOwn(r.costs,key)) throw Error('Unknown build cost.');
      r.costs[key] = checkedCards(cost, 20);
    }
  }
  return r;
}
