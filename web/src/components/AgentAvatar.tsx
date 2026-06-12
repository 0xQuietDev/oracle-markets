// Emoji identity per fleet agentId (local registration order). Unknown ids
// (e.g. audience wallets on Fuji) fall back to 🎲.

const AVATARS: Record<number, { emoji: string; name: string }> = {
  1: { emoji: "🤖", name: "worker" },
  2: { emoji: "⚖️", name: "validator" },
  3: { emoji: "🧠", name: "rep" },
  4: { emoji: "🦨", name: "skeptic" },
  5: { emoji: "🪞", name: "mirror" },
  6: { emoji: "🏪", name: "vendor" },
};

export function agentMeta(agentId: number): { emoji: string; name: string } {
  return AVATARS[agentId] ?? { emoji: "🎲", name: `agent #${agentId}` };
}

export function AgentAvatar({ agentId }: { agentId: number }) {
  const m = agentMeta(agentId);
  return (
    <span className="avatar" title={`${m.name} (agent #${agentId})`} role="img" aria-label={m.name}>
      {m.emoji}
    </span>
  );
}
