// Small shared presentational helpers built on HeroUI primitives — kept here so
// the feature components stay focused. No business logic; pure display.

import { Chip } from "@heroui/react";
import { roleMeta } from "./AgentAvatar.js";

/** A circular emoji avatar for an agent role, sized for feeds / nodes. */
export function RoleBadge({ role, size = "md" }: { role: string; size?: "sm" | "md" | "lg" }) {
  const m = roleMeta(role);
  const dim =
    size === "lg" ? "size-10 text-xl" : size === "sm" ? "size-7 text-sm" : "size-9 text-lg";
  return (
    <span
      className={`flex ${dim} shrink-0 items-center justify-center rounded-full bg-surface-secondary ring-1 ring-default/60`}
      role="img"
      aria-label={m.name}
      title={m.name}
    >
      {m.emoji}
    </span>
  );
}

/** 🧠 Gemini vs ⚙️ rule honesty tag. */
export function SourceTag({ source }: { source?: "gemini" | "rule" }) {
  if (source === "gemini")
    return (
      <Chip size="sm" variant="soft" color="accent">
        <Chip.Label>🧠 Gemini</Chip.Label>
      </Chip>
    );
  if (source === "rule")
    return (
      <Chip size="sm" variant="soft" color="default">
        <Chip.Label>⚙️ rule</Chip.Label>
      </Chip>
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
