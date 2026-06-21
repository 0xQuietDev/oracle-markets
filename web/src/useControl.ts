// Shared GET /v1/control fetch — capabilities for the create-task control and
// the trade ticket: whether the control plane is up, whether the human can bet,
// the minimum bet (USDC units), the human's address, and the task templates.
// One small hook so MarketsView (create) and TradeTicket (bet) agree on state.

import { useEffect, useState } from "react";
import { REST_BASE } from "./ws.js";

export type Template = { template: string; fn?: string; title?: string };

export interface ControlInfo {
  available: boolean;
  reason?: string;
  templates: Template[];
  canBet: boolean;
  humanAgentId?: number;
  humanAddress?: string;
  /** minimum bet in USDC units (6dp) string */
  minBet?: string;
}

export type ControlLoad =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; info: ControlInfo };

/** Fetch /v1/control once. In mock mode there is no backend, so callers pass
 * isMock to short-circuit to a friendly disabled state. */
export function useControl(isMock: boolean): ControlLoad {
  const [load, setLoad] = useState<ControlLoad>(
    isMock
      ? { status: "ok", info: { available: false, reason: "Demo mode — connect the backend to trade.", templates: [], canBet: false } }
      : { status: "loading" },
  );

  useEffect(() => {
    if (isMock) return;
    let cancelled = false;
    fetch(`${REST_BASE}/v1/control`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`server returned ${r.status}`);
        return (await r.json()) as ControlInfo;
      })
      .then((info) => !cancelled && setLoad({ status: "ok", info }))
      .catch((e: unknown) => {
        if (!cancelled)
          setLoad({ status: "error", message: e instanceof Error ? e.message : "fetch failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [isMock]);

  return load;
}
