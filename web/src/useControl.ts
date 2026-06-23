// Shared GET /v1/control fetch — capabilities for the create-task control:
// whether the control plane is up and the available task templates. The server
// also returns betting fields (canBet/humanAgentId/humanAddress/minBet) for the
// retained on-chain human-bet path; they are kept on the type but no UI consumes
// them since human betting was removed from the UI.

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
