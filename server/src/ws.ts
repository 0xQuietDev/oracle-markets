// WebSocket push (server -> web) — protocol frozen in plan §2.5, extended with
// the demo-console channels (activity, payment, tx, director) per spec
// 2026-06-13-demo-console (shared/src/console-types.ts is the binding contract).
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type {
  ActivityItem,
  PaymentEvent,
  TxEvent,
  DirectorStatus,
} from "@oracle/shared/console-types";
import type { OracleDb, TaskRow, BetRow } from "./db.js";

export type WsMessage =
  | {
      type: "snapshot";
      tasks: TaskRow[];
      activity: ActivityItem[];
      payments: PaymentEvent[];
      txs: TxEvent[];
      director: DirectorStatus;
    }
  | { type: "task"; task: TaskRow }
  | { type: "bet"; taskId: number; bet: BetRow; pBps: number }
  | { type: "settled"; taskId: number; outcome: "Yes" | "No"; viaRule: number; validatorScore: number }
  | { type: "activity"; item: ActivityItem }
  | { type: "payment"; payment: PaymentEvent }
  | { type: "tx"; tx: TxEvent }
  | { type: "director"; status: DirectorStatus };

export type Broadcaster = { broadcast: (msg: WsMessage) => void; close: () => void };

/** Getters that source the console snapshot buffers (live, by-reference). */
export type SnapshotSources = {
  activity: () => ActivityItem[];
  payments: () => PaymentEvent[];
  txs: () => TxEvent[];
  director: () => DirectorStatus;
};

export function attachWs(server: Server, db: OracleDb, sources: SnapshotSources): Broadcaster {
  const wss = new WebSocketServer({ server });
  wss.on("connection", (sock) => {
    const snapshot: WsMessage = {
      type: "snapshot",
      tasks: db.listTasks(),
      activity: sources.activity(),
      payments: sources.payments(),
      txs: sources.txs(),
      director: sources.director(),
    };
    sock.send(JSON.stringify(snapshot));
  });
  return {
    broadcast(msg: WsMessage) {
      const data = JSON.stringify(msg);
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(data);
      }
    },
    close() {
      wss.close();
    },
  };
}
