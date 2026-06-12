// WebSocket push (server -> web) — protocol frozen in plan §2.5.
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { OracleDb, TaskRow, BetRow } from "./db.js";

export type WsMessage =
  | { type: "snapshot"; tasks: TaskRow[] }
  | { type: "task"; task: TaskRow }
  | { type: "bet"; taskId: number; bet: BetRow; pBps: number }
  | { type: "settled"; taskId: number; outcome: "Yes" | "No"; viaRule: number; validatorScore: number };

export type Broadcaster = { broadcast: (msg: WsMessage) => void; close: () => void };

export function attachWs(server: Server, db: OracleDb): Broadcaster {
  const wss = new WebSocketServer({ server });
  wss.on("connection", (sock) => {
    const snapshot: WsMessage = { type: "snapshot", tasks: db.listTasks() };
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
