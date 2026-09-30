import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildRaffleReportSeries,
  resolveRaffleReportRange,
  summarizeRaffleReport,
} from "../src/domain/entities/RaffleReport.ts";

test("summary separates current raffle outcomes and computes offer reach", () => {
  const people = [
    { id: "1", username: "a", fullName: "A", raffleStatus: null },
    { id: "2", username: "b", fullName: "B", raffleStatus: "offered" },
    { id: "3", username: "c", fullName: "C", raffleStatus: "bought" },
    { id: "4", username: "d", fullName: "D", raffleStatus: "not_bought" },
  ];

  const summary = summarizeRaffleReport(people);
  assert.equal(summary.totalFinalized, 4);
  assert.equal(summary.notOffered, 1);
  assert.equal(summary.offered, 1);
  assert.equal(summary.bought, 1);
  assert.equal(summary.notBought, 1);
  assert.equal(summary.offersReached, 3);
  assert.equal(summary.offerRate, 75);
  assert.ok(Math.abs(summary.purchaseRate - (100 / 3)) < 1e-9);
  assert.equal(summary.resolvedPurchaseRate, 50);
});

test("preset ranges use calendar day, week, month and year boundaries", () => {
  const now = new Date(2026, 8, 30, 17, 30);

  const day = resolveRaffleReportRange("day", now);
  assert.equal(day.start.getDate(), 30);
  assert.equal(day.end.getDate(), 1);

  const week = resolveRaffleReportRange("week", now);
  assert.equal(week.start.getDay(), 1);
  assert.equal(week.end.getDay(), 1);

  const month = resolveRaffleReportRange("month", now);
  assert.equal(month.start.getDate(), 1);
  assert.equal(month.start.getMonth(), 8);
  assert.equal(month.end.getMonth(), 9);

  const year = resolveRaffleReportRange("year", now);
  assert.equal(year.start.getMonth(), 0);
  assert.equal(year.start.getDate(), 1);
  assert.equal(year.end.getFullYear(), 2027);
});

test("commercial timeline preserves offered then bought as two historical events", () => {
  const range = {
    start: new Date(2026, 8, 30),
    end: new Date(2026, 9, 1),
    label: "Teste",
  };
  const events = [
    {
      id: "1",
      conversationId: "abc",
      previousStatus: null,
      status: "offered",
      changedAt: new Date(2026, 8, 30, 10).toISOString(),
    },
    {
      id: "2",
      conversationId: "abc",
      previousStatus: "offered",
      status: "bought",
      changedAt: new Date(2026, 8, 30, 12).toISOString(),
    },
  ];

  const series = buildRaffleReportSeries(events, range);
  assert.equal(series.length, 1);
  assert.equal(series[0].offered, 1);
  assert.equal(series[0].bought, 1);
  assert.equal(series[0].total, 2);
});

test("backend report reads normalized timestamps and history table", () => {
  const source = fs.readFileSync(
    new URL("../supabase/functions/api/operator_chat_progress.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /operation === "raffle_report"/);
  assert.match(source, /workflow_finalized_at/);
  assert.match(source, /raffle_commercial_events/);
  assert.match(source, /raffle_status_updated_at/);
});

test("migration records status history and normalized finalization timestamps", () => {
  const migrations = fs.readdirSync(new URL("../supabase/migrations/", import.meta.url));
  const migration = migrations.find((name) => name.endsWith("_raffle_report_tracking.sql"));
  assert.ok(migration);
  const sql = fs.readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8");

  assert.match(sql, /create table if not exists public\.raffle_commercial_events/i);
  assert.match(sql, /raffle_status_updated_at timestamptz/i);
  assert.match(sql, /workflow_finalized_at timestamptz/i);
  assert.match(sql, /after update of raffle_status/i);
  assert.match(sql, /enable row level security/i);
});

test("sales screen exposes a third report tab", () => {
  const source = fs.readFileSync(
    new URL("../src/presentation/components/sales/SalesView.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /"raffles" \| "clothes" \| "report"/);
  assert.match(source, />Relatório</);
  assert.match(source, /<RaffleReportView/);
});
