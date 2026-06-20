// Opened by clicking a flow-canvas node: that agent's activity history (filtered
// by role) plus, for the worker, the code it wrote. Built on a controlled HeroUI
// Drawer; solution rows are clickable → the WorkerCodeModal.

import { Chip, Drawer } from "@heroui/react";
import { clockTime, usd } from "../format.js";
import { RoleBadge, SideChip } from "./ui.js";
import type { ActivityItem } from "../types.js";

const ROLE_ALIASES: Record<string, string[]> = {
  worker: ["worker"],
  bettorRep: ["bettorRep", "rep"],
  rep: ["bettorRep", "rep"],
  bettorSkeptic: ["bettorSkeptic", "skeptic"],
  skeptic: ["bettorSkeptic", "skeptic"],
  bettorMirror: ["bettorMirror", "mirror"],
  mirror: ["bettorMirror", "mirror"],
  validator: ["validator"],
  vendor: ["vendor"],
  client: ["client"],
  oracle: ["oracle", "info"],
  infra: [],
};

export function AgentDrawer({
  role,
  label,
  activity,
  onClose,
  onOpenCode,
}: {
  role: string;
  label: string;
  activity: ActivityItem[];
  onClose: () => void;
  onOpenCode: (item: ActivityItem) => void;
}) {
  const aliases = ROLE_ALIASES[role] ?? [role];
  const items = activity.filter((a) => aliases.includes(a.role)).slice().reverse();

  return (
    <Drawer.Backdrop variant="blur" isOpen onOpenChange={(o) => !o && onClose()}>
      <Drawer.Content placement="right" className="w-full max-w-[420px]">
        <Drawer.Dialog>
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <div className="flex items-center gap-3">
              <RoleBadge role={role} size="lg" />
              <div className="flex flex-col gap-0.5">
                <span className="text-xs uppercase tracking-widest text-muted">agent history</span>
                <Drawer.Heading className="text-base">{label}</Drawer.Heading>
              </div>
            </div>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-2">
            {items.length === 0 && (
              <p className="text-sm text-muted">No activity for {label} yet…</p>
            )}
            {items.map((it, i) => {
              const clickable = it.kind === "solution" && it.code;
              return (
                <div
                  key={`${it.ts}-${i}`}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? () => onOpenCode(it) : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => (e.key === "Enter" || e.key === " ") && onOpenCode(it)
                      : undefined
                  }
                  className={[
                    "flex flex-col gap-1 rounded-xl p-2.5 ring-1 transition",
                    clickable
                      ? "cursor-pointer bg-surface-secondary ring-default/50 hover:ring-accent/60"
                      : "bg-surface-secondary/50 ring-default/40",
                  ].join(" ")}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip size="sm" variant="soft" color="default">
                      <Chip.Label>{it.kind}</Chip.Label>
                    </Chip>
                    {it.side && <SideChip side={it.side} />}
                    {it.amount && (
                      <span className="tnum text-xs font-medium text-muted">{usd(it.amount)}</span>
                    )}
                    {it.score != null && (
                      <Chip size="sm" variant="soft" color="accent">
                        <Chip.Label>score {it.score}</Chip.Label>
                      </Chip>
                    )}
                    <span className="tnum ml-auto text-[10px] text-muted">{clockTime(it.ts)}</span>
                  </div>
                  <p className="text-sm leading-snug text-foreground/90">{it.text}</p>
                  {clickable && (
                    <span className="text-xs font-medium text-accent">⌨ view solution code →</span>
                  )}
                </div>
              );
            })}
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
