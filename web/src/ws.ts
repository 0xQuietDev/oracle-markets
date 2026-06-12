// Reconnecting WebSocket client for the frozen plan §2.5 protocol.
// Dispatches parsed server messages straight into the reducer, plus a local
// "connection" action for the status pill. Reconnects with a 1s backoff.

import type { StoreAction } from "./types";

export type Dispatcher = (action: StoreAction) => void;

const KNOWN_TYPES = new Set(["snapshot", "task", "bet", "settled"]);

export const DEFAULT_WS_URL =
  (import.meta.env?.VITE_ORACLE_WS as string | undefined) ?? "ws://localhost:8402";

/**
 * Connect and keep connected. Returns a cleanup function that stops
 * reconnecting and closes the socket (React effect-friendly).
 */
export function connectWs(url: string, dispatch: Dispatcher): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (stopped) return;
    ws = new WebSocket(url);

    ws.onopen = () => dispatch({ type: "connection", connected: true });

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        if (msg && typeof msg === "object" && KNOWN_TYPES.has(msg.type)) {
          dispatch(msg as StoreAction);
        }
      } catch {
        // malformed frame — ignore, never crash the stage dashboard
      }
    };

    ws.onclose = () => {
      dispatch({ type: "connection", connected: false });
      if (!stopped) timer = setTimeout(open, 1000); // 1s backoff
    };

    ws.onerror = () => {
      ws?.close(); // funnels into onclose -> reconnect
    };
  };

  open();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (ws) {
      ws.onclose = null; // don't schedule a reconnect from our own close
      ws.close();
      dispatch({ type: "connection", connected: false });
    }
  };
}
