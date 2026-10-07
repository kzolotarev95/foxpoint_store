import assert from "node:assert/strict";
import { extendSubscriptionEnd, DAY_MS } from "../apps/api/dist/subscription-period.js";
import { getImportPlan, validateClientDatabase } from "../apps/api/dist/client-database-import.js";

const paidAt = new Date("2026-01-31T12:00:00Z");
assert.equal(extendSubscriptionEnd(new Date(paidAt.getTime() + 5 * DAY_MS), 30, paidAt).getTime(), paidAt.getTime() + 35 * DAY_MS);
assert.equal(extendSubscriptionEnd(new Date("2026-01-01"), 30, paidAt).toISOString(), "2026-03-02T12:00:00.000Z");
assert.equal(extendSubscriptionEnd(null, 60, paidAt).getTime(), paidAt.getTime() + 60 * DAY_MS);
for (const days of [0, -1, 1.5, Infinity, 3651]) assert.throws(() => extendSubscriptionEnd(null, days, paidAt));
const row = { clientCode: "CLI-0099", name: "Test", phone: null, telegram: null, city: null,
  routerName: "Test router", tariff: "Сервер", state: "Активен", monthlyPrice: 149,
  startDate: "2026-01-31", paidMonths: 1, paidAmount: 1000, note: null };
const plan = getImportPlan(validateClientDatabase([row])[0]);
assert.equal(plan.monthlyPrice, 1000); // Excel column I is not the server sale price.
assert.equal(plan.endAt.getTime() - plan.startAt.getTime(), 30 * DAY_MS);
assert.equal(getImportPlan({ ...row, tariff: "Индивидуальный", monthlyPrice: 500 }).monthlyPrice, 500);
assert.equal(getImportPlan({ ...row, tariff: "Самостоятельно" }).monthlyPrice, 0);
assert.throws(() => validateClientDatabase([row, row]));
assert.throws(() => validateClientDatabase([{ ...row, startDate: null }]));
assert.throws(() => validateClientDatabase([{ ...row, startDate: "2026-02-31" }]));
console.log("PASS: 5 + 30 = 35; expired and new periods; month boundary; import tariff prices; invalid input.");
