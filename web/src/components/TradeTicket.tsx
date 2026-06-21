// TRADE TICKET — the control that makes the detail view feel like a market.
// A YES/NO toggle (two big buttons showing current ¢), a USDC amount NumberField,
// a computed Cost / Potential payout line, and a primary "Place bet" button that
// POSTs /v1/control/bet { taskId, side:"YES"|"NO", amountUnits } where
// amountUnits = whole-USDC × 1_000_000 (string). Toast on success/failure.
// Only enabled while the market is Open (betting) AND control.canBet; otherwise
// shows why. Respects minBet (USDC units).

import { Button, Label, NumberField, Spinner, toast } from "@heroui/react";
import { useState } from "react";
import { usd } from "../format.js";
import type { ControlLoad } from "../useControl.js";
import { REST_BASE } from "../ws.js";

type Side = "YES" | "NO";

export function TradeTicket({
  taskId,
  yesCents,
  noCents,
  bettingOpen,
  closedReason,
  control,
}: {
  taskId: number;
  yesCents: number;
  noCents: number;
  bettingOpen: boolean;
  /** why betting is closed (when bettingOpen is false) */
  closedReason: string;
  control: ControlLoad;
}) {
  const [side, setSide] = useState<Side>("YES");
  const [amount, setAmount] = useState<number>(10);
  const [placing, setPlacing] = useState(false);

  const canBet = control.status === "ok" && control.info.canBet;
  const minBetUnits = control.status === "ok" ? control.info.minBet : undefined;
  const minBetUsd = minBetUnits ? Number(minBetUnits) / 1e6 : 0;

  // disable reasons in priority order
  const controlReason =
    control.status === "loading"
      ? "Checking control plane…"
      : control.status === "error"
        ? "Control plane unreachable."
        : !control.info.available
          ? control.info.reason ?? "Control plane offline."
          : !canBet
            ? control.info.reason ?? "Betting not available — no human wallet registered."
            : undefined;

  const belowMin = minBetUsd > 0 && amount < minBetUsd;
  const validAmount = Number.isFinite(amount) && amount > 0 && !belowMin;

  const disabled = !bettingOpen || !!controlReason || !validAmount || placing;

  // pricing math: cost = amount (the stake). a winning $X at p¢ pays $X * 100/p.
  const priceCents = side === "YES" ? yesCents : noCents;
  const payout = priceCents > 0 ? (amount * 100) / priceCents : 0;

  const placeBet = async () => {
    const amountUnits = Math.round(amount * 1_000_000).toString();
    setPlacing(true);
    try {
      const r = await fetch(`${REST_BASE}/v1/control/bet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId, side, amountUnits }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        reason?: string;
        txHash?: string;
      };
      if (!r.ok || !body.ok) {
        toast.danger("Bet rejected", {
          description: body.message ?? body.reason ?? body.error ?? `server returned ${r.status}`,
        });
        return;
      }
      toast.success(`${side} bet placed · ${usd(amountUnits)}`, {
        description: "On-chain — watch it move the order flow.",
      });
    } catch (e) {
      toast.danger("Bet failed", {
        description: e instanceof Error ? e.message : "network error",
      });
    } finally {
      setPlacing(false);
    }
  };

  return (
    <section className="glass flex flex-col gap-4 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-foreground">Trade</h3>
        {minBetUsd > 0 && (
          <span className="font-mono text-[11px] text-muted tnum">min {usd(minBetUnits)}</span>
        )}
      </div>

      {/* YES / NO toggle */}
      <div className="grid grid-cols-2 gap-2">
        {(["YES", "NO"] as Side[]).map((s) => {
          const active = side === s;
          const cents = s === "YES" ? yesCents : noCents;
          const tone = s === "YES" ? "var(--yes)" : "var(--no)";
          return (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              aria-pressed={active}
              className="flex flex-col items-center gap-0.5 rounded-lg border py-2.5 transition-colors"
              style={{
                borderColor: active ? tone : "var(--glass-border)",
                background: active ? `color-mix(in oklch, ${tone} 16%, transparent)` : "transparent",
                color: active ? tone : "var(--foreground)",
              }}
            >
              <span className="text-xs font-semibold tracking-wide">{s}</span>
              <span className="font-mono tnum text-lg font-bold">{cents}¢</span>
            </button>
          );
        })}
      </div>

      {/* amount */}
      <NumberField
        value={amount}
        onChange={(v) => setAmount(Number.isNaN(v) ? 0 : v)}
        minValue={0}
        step={1}
        isDisabled={!bettingOpen || !!controlReason || placing}
        formatOptions={{ style: "currency", currency: "USD", maximumFractionDigits: 0 }}
      >
        <Label className="text-xs text-muted">Amount (USDC)</Label>
        <NumberField.Group>
          <NumberField.DecrementButton />
          <NumberField.Input className="flex-1 font-mono tnum" />
          <NumberField.IncrementButton />
        </NumberField.Group>
      </NumberField>

      {/* cost / payout */}
      <dl className="flex flex-col gap-1.5 rounded-lg border border-[var(--hairline)] p-3 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-muted">Cost</dt>
          <dd className="font-mono tnum font-medium text-foreground">
            {usd(Math.round(amount * 1_000_000).toString())}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted">Potential payout</dt>
          <dd
            className="font-mono tnum font-semibold"
            style={{ color: side === "YES" ? "var(--yes)" : "var(--no)" }}
          >
            {usd(Math.round(payout * 1_000_000).toString())}
          </dd>
        </div>
      </dl>

      <Button onPress={placeBet} isDisabled={disabled} className="w-full">
        {placing && <Spinner size="sm" color="current" />}
        {placing ? "Placing…" : `Place ${side} bet`}
      </Button>

      {!bettingOpen ? (
        <p className="text-center text-xs text-muted">{closedReason}</p>
      ) : controlReason ? (
        <p className="text-center text-xs text-warning">⚠ {controlReason}</p>
      ) : belowMin ? (
        <p className="text-center text-xs text-warning">Minimum bet is {usd(minBetUnits)}.</p>
      ) : null}
    </section>
  );
}
