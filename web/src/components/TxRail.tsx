// A horizontal rail of clickable on-chain tx chips (the proof trail). Clicking
// any chip opens the TxDrawer mini-explorer for that hash.

import { shortHash } from "../format.js";
import type { TxEvent } from "../types.js";

const KIND_EMOJI: Record<string, string> = {
  create: "📝",
  accept: "🤝",
  bet: "🎲",
  deliver: "📦",
  settle: "⚖️",
  feedback: "🗣️",
  claim: "💰",
};

export function TxRail({
  txs,
  onOpenTx,
}: {
  txs: TxEvent[];
  onOpenTx: (hash: string) => void;
}) {
  if (txs.length === 0) return null;
  const recent = txs.slice(-12);
  return (
    <div className="tx-rail">
      <span className="tx-rail-label">on-chain</span>
      {recent.map((tx, i) => (
        <button
          key={`${tx.txHash}-${i}`}
          className="tx-chip"
          onClick={() => onOpenTx(tx.txHash)}
          title={`${tx.kind} · ${tx.txHash}`}
        >
          <span className="tx-chip-kind">
            {KIND_EMOJI[tx.kind] ?? "•"} {tx.label ?? tx.kind}
          </span>
          <span className="tx-chip-hash mono">{shortHash(tx.txHash)}</span>
        </button>
      ))}
    </div>
  );
}
