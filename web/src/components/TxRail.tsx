// Horizontal rail of clickable on-chain tx chips (the proof trail). Clicking a
// chip opens the TxDrawer mini-explorer for that hash. HeroUI Chips inside a
// ScrollShadow so a long trail scrolls cleanly.

import { Chip, ScrollShadow } from "@heroui/react";
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
  const recent = txs.slice(-14);
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">
        on-chain
      </span>
      <ScrollShadow orientation="horizontal" className="flex-1">
        <div className="flex items-center gap-2 py-1">
          {recent.map((tx, i) => (
            <button
              key={`${tx.txHash}-${i}`}
              type="button"
              onClick={() => onOpenTx(tx.txHash)}
              title={`${tx.kind} · ${tx.txHash}`}
              className="shrink-0"
            >
              <Chip variant="soft" color="default" className="cursor-pointer hover:ring-1 hover:ring-accent/60">
                <Chip.Label className="tnum">
                  {KIND_EMOJI[tx.kind] ?? "•"} {tx.label ?? tx.kind} ·{" "}
                  <span className="font-mono opacity-70">{shortHash(tx.txHash)}</span>
                </Chip.Label>
              </Chip>
            </button>
          ))}
        </div>
      </ScrollShadow>
    </div>
  );
}
