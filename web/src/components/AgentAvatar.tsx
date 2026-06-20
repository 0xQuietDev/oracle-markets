// Emoji identity per fleet agentId (local registration order) and per role
// string (from ActivityItem.role). Unknown ids fall back to 🎲.

const AVATARS: Record<number, { emoji: string; name: string }> = {
  1: { emoji: "🤖", name: "worker" },
  2: { emoji: "⚖️", name: "validator" },
  3: { emoji: "🧠", name: "rep" },
  4: { emoji: "🦨", name: "skeptic" },
  5: { emoji: "🪞", name: "mirror" },
  6: { emoji: "🏪", name: "vendor" },
};

const ROLE_AVATARS: Record<string, { emoji: string; name: string }> = {
  worker: { emoji: "🤖", name: "worker" },
  validator: { emoji: "⚖️", name: "validator" },
  bettorRep: { emoji: "🧠", name: "rep" },
  rep: { emoji: "🧠", name: "rep" },
  bettorSkeptic: { emoji: "🦨", name: "skeptic" },
  skeptic: { emoji: "🦨", name: "skeptic" },
  bettorMirror: { emoji: "🪞", name: "mirror" },
  mirror: { emoji: "🪞", name: "mirror" },
  vendor: { emoji: "🏪", name: "vendor" },
  client: { emoji: "🧑", name: "client" },
  oracle: { emoji: "🔮", name: "oracle" },
};

export function agentMeta(agentId: number): { emoji: string; name: string } {
  return AVATARS[agentId] ?? { emoji: "🎲", name: `agent #${agentId}` };
}

export function roleMeta(role: string): { emoji: string; name: string } {
  return ROLE_AVATARS[role] ?? { emoji: "🎲", name: role };
}

export function AgentAvatar({ agentId }: { agentId: number }) {
  const m = agentMeta(agentId);
  return (
    <span className="avatar" title={`${m.name} (agent #${agentId})`} role="img" aria-label={m.name}>
      {m.emoji}
    </span>
  );
}

export function RoleAvatar({ role }: { role: string }) {
  const m = roleMeta(role);
  return (
    <span className="avatar" title={m.name} role="img" aria-label={m.name}>
      {m.emoji}
    </span>
  );
}
