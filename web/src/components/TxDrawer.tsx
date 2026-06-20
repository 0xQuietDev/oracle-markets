// The bundled mini-explorer. Clicking any tx chip opens this drawer, which
// fetches GET /v1/tx/:hash and renders the decoded TxReceiptView: block,
// status, gasUsed, decoded events. This is the "real on-chain" proof — anvil
// has no public explorer, so the server decodes the receipt for us.

import { useEffect, useState } from "react";
import { shortHash } from "../format.js";
import { REST_BASE } from "../ws.js";
import type { TxReceiptView } from "../types.js";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; receipt: TxReceiptView };

export function TxDrawer({ txHash, onClose }: { txHash: string; onClose: () => void }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    fetch(`${REST_BASE}/v1/tx/${txHash}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`server returned ${r.status}`);
        return (await r.json()) as TxReceiptView;
      })
      .then((receipt) => {
        if (!cancelled) setLoad({ status: "ok", receipt });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setLoad({ status: "error", message: e instanceof Error ? e.message : "fetch failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [txHash]);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer tx-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <div className="drawer-kicker">mini-explorer · on-chain receipt</div>
            <div className="drawer-title mono">{shortHash(txHash)}</div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="close">
            ✕
          </button>
        </header>

        {load.status === "loading" && <div className="drawer-info">decoding receipt…</div>}
        {load.status === "error" && (
          <div className="drawer-error">
            could not load receipt: {load.message}
            <div className="mono tx-hash-full">{txHash}</div>
          </div>
        )}
        {load.status === "ok" && <Receipt r={load.receipt} />}
      </div>
    </div>
  );
}

function Receipt({ r }: { r: TxReceiptView }) {
  return (
    <div className="receipt">
      <dl className="receipt-grid">
        <dt>status</dt>
        <dd>
          <span className={r.status === "success" ? "rc-ok" : "rc-bad"}>
            {r.status === "success" ? "✓ success" : "✗ reverted"}
          </span>
        </dd>
        <dt>block</dt>
        <dd className="mono">#{r.blockNumber}</dd>
        <dt>from</dt>
        <dd className="mono">{shortHash(r.from)}</dd>
        <dt>to</dt>
        <dd className="mono">{r.to ? shortHash(r.to) : "(contract creation)"}</dd>
        <dt>gas used</dt>
        <dd className="mono">{Number(r.gasUsed).toLocaleString("en-US")}</dd>
      </dl>

      <div className="receipt-events">
        <div className="receipt-events-head">decoded events ({r.events.length})</div>
        {r.events.length === 0 && <div className="drawer-info">no decoded events</div>}
        {r.events.map((ev, i) => (
          <div key={i} className="event-row">
            <div className="event-name">{ev.name}</div>
            <dl className="event-args">
              {Object.entries(ev.args).map(([k, v]) => (
                <div key={k} className="event-arg">
                  <dt>{k}</dt>
                  <dd className="mono">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
