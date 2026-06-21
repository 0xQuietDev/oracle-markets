// Small shared presentational helpers built on HeroUI primitives — kept here so
// the feature components stay focused. No business logic; pure display.

import { Chip } from "@heroui/react";
import { roleMeta } from "./AgentAvatar.js";

/** A circular emoji avatar for an agent role, sized for feeds / nodes. Wrapped
 * in a soft brand gradient ring. */
export function RoleBadge({ role, size = "md" }: { role: string; size?: "sm" | "md" | "lg" }) {
  const m = roleMeta(role);
  const dim =
    size === "lg" ? "size-10 text-xl" : size === "sm" ? "size-7 text-sm" : "size-9 text-lg";
  return (
    <span
      className="shrink-0 rounded-full p-px"
      style={{
        background: "linear-gradient(135deg, color-mix(in oklch, var(--g1) 55%, transparent), color-mix(in oklch, var(--g3) 45%, transparent))",
      }}
    >
      <span
        className={`flex ${dim} items-center justify-center rounded-full bg-[oklch(0.18_0.025_282)]`}
        role="img"
        aria-label={m.name}
        title={m.name}
      >
        {m.emoji}
      </span>
    </span>
  );
}

/** 🧠 Gemini vs ⚙️ rule honesty tag — refined micro-chips. */
export function SourceTag({ source }: { source?: "gemini" | "rule" }) {
  if (source === "gemini")
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_oklch,var(--g2)_45%,transparent)] bg-[var(--brand-soft)] px-2 py-0.5 text-[10px] font-medium text-foreground/85">
        🧠 Gemini
      </span>
    );
  if (source === "rule")
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--glass-border)] bg-[oklch(0.99_0_0/0.04)] px-2 py-0.5 text-[10px] font-medium text-muted">
        ⚙️ rule
      </span>
    );
  return null;
}

/** YES / NO side chip mapped to success / danger semantics. */
export function SideChip({ side }: { side: "YES" | "NO" }) {
  return (
    <Chip size="sm" variant="soft" color={side === "YES" ? "success" : "danger"}>
      <Chip.Label>{side}</Chip.Label>
    </Chip>
  );
}
