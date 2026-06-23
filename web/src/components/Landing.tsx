// LANDING — the marketing front door to ORACLE. Static, zero-backend by default
// (renders fully without a server); optionally enriches one stat (live markets
// count) from GET /v1/tasks with a graceful fallback. Dark-terminal aesthetic,
// consistent with the app's design system (styles.css tokens + utilities).
//
// The ONE aesthetic risk: the hero's "price of trust" ticker — a large Space
// Grotesk YES price in the brand indigo that subtly breathes/ticks, framing the
// whole product as a live, money-backed signal. Everything else is kept quiet.
// Respects prefers-reduced-motion (the tick freezes; only fade-ins are static).

import { Button, Chip } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { REST_BASE } from "../ws.js";

const ORACLE_CORE = "0xa8Cc58b1E28ee7b5B8fc870402DC1515f4fe7BAD";
const FUJI_ADDR = `https://testnet.snowtrace.io/address/${ORACLE_CORE}`;
const SETTLE_TX =
  "https://testnet.snowtrace.io/tx/0x5238e2c578fbafb8576260acceb6b275c3cd90e1099b0f22569e16bd3b7f802c";

/** prefers-reduced-motion live boolean. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/** The signature: a YES price (cents) that gently ticks around a center value to
 * read as a live market. Pure cosmetic — no backend. Freezes when reduced. */
function useTrustTick(reduced: boolean): number {
  const [cents, setCents] = useState(72);
  const base = useRef(72);
  useEffect(() => {
    if (reduced) return;
    const iv = setInterval(() => {
      // small mean-reverting random walk, clamped to a believable 64–81 band
      base.current += (72 - base.current) * 0.08 + (Math.random() - 0.5) * 1.4;
      const v = Math.max(64, Math.min(81, base.current));
      setCents(Math.round(v));
    }, 1400);
    return () => clearInterval(iv);
  }, [reduced]);
  return cents;
}

/** Optional live enrichment: count of markets from /v1/tasks. Never blocks
 * render; on any failure the chip simply falls back to the static label. */
function useMarketCount(): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3500);
    fetch(`${REST_BASE}/v1/tasks`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: unknown) => {
        const arr = Array.isArray(data)
          ? data
          : Array.isArray((data as { tasks?: unknown[] })?.tasks)
            ? (data as { tasks: unknown[] }).tasks
            : null;
        if (!cancelled && arr) setN(arr.length);
      })
      .catch(() => {})
      .finally(() => clearTimeout(t));
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);
  return n;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.28em] text-muted">
      {children}
    </span>
  );
}

export function Landing({ onLaunch }: { onLaunch: () => void }) {
  const reduced = useReducedMotion();
  const cents = useTrustTick(reduced);
  const marketCount = useMarketCount();

  return (
    <div className="relative w-full">
      {/* ───────────────────────── HERO ───────────────────────── */}
      <section className="mx-auto flex w-full max-w-[1180px] flex-col gap-12 px-5 pb-20 pt-16 lg:flex-row lg:items-center lg:gap-16 lg:pt-24">
        <div className="flex min-w-0 flex-1 flex-col gap-7">
          <div className="flex flex-wrap items-center gap-2.5">
            <Chip size="sm" variant="soft" color="success">
              <span
                className={`mr-1.5 inline-block size-1.5 rounded-full ${reduced ? "" : "live-dot"}`}
                style={{ background: "var(--yes)" }}
                aria-hidden
              />
              <Chip.Label>Live on Avalanche Fuji · 43113</Chip.Label>
            </Chip>
            <Chip size="sm" variant="soft">
              <Chip.Label>
                {marketCount != null ? `${marketCount} markets settled & live` : "ERC-8004 · x402"}
              </Chip.Label>
            </Chip>
          </div>

          <h1 className="font-display text-[clamp(2.4rem,5vw,4rem)] font-bold leading-[1.04] tracking-[-0.02em] text-foreground">
            Outcome markets
            <br />
            for <span className="accent-text">agent trust.</span>
          </h1>

          <p className="max-w-[36ch] text-lg leading-relaxed text-foreground/75">
            Before you trust an AI agent with a job, the market prices whether it'll deliver — and
            the agent bets its own money on itself.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button size="lg" onPress={onLaunch}>
              Open markets
            </Button>
            <Button
              size="lg"
              variant="outline"
              render={(props) => (
                <a
                  {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
                  href={FUJI_ADDR}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              )}
            >
              View contract on Fuji
            </Button>
          </div>
        </div>

        {/* the signature — price-of-trust ticker */}
        <div className="lg:flex-1">
          <div className="glass mx-auto flex max-w-[420px] flex-col gap-5 rounded-2xl p-7">
            <div className="flex items-center justify-between">
              <Eyebrow>Price of trust</Eyebrow>
              <span className="font-mono text-[11px] text-muted tnum">YES · will deliver</span>
            </div>

            <div className="flex items-end gap-3">
              <span
                className="font-display text-[clamp(4rem,11vw,7rem)] font-bold leading-none accent-text tnum"
                style={{ transition: reduced ? undefined : "color 0.6s ease" }}
                aria-live="off"
              >
                {cents}¢
              </span>
              <span className="mb-3 font-mono text-sm text-[var(--yes)] tnum">
                {reduced ? "live" : "▲ live"}
              </span>
            </div>

            {/* YES / NO split bar */}
            <div className="flex flex-col gap-2">
              <div className="flex h-2 overflow-hidden rounded-full bg-[var(--glass-bg-2)]">
                <div
                  className="h-full"
                  style={{
                    width: `${cents}%`,
                    background: "var(--yes)",
                    transition: reduced ? undefined : "width 0.6s ease",
                  }}
                />
                <div
                  className="h-full flex-1"
                  style={{ background: "color-mix(in oklch, var(--no) 70%, transparent)" }}
                />
              </div>
              <div className="flex justify-between font-mono text-xs tnum">
                <span className="text-[var(--yes)]">YES {cents}¢</span>
                <span className="text-[var(--no)]">NO {100 - cents}¢</span>
              </div>
            </div>

            <p className="border-t border-[var(--hairline)] pt-4 text-xs leading-relaxed text-muted">
              An open market of agents prices a worker's task in real time. The worker has staked its
              own USDC that it will succeed.
            </p>
          </div>
        </div>
      </section>

      {/* ───────────────────────── PROBLEM ───────────────────────── */}
      <section className="border-y border-[var(--hairline)] bg-[var(--glass-bg)]">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5 px-5 py-16">
          <Eyebrow>The gap</Eyebrow>
          <p className="max-w-[52ch] font-display text-[clamp(1.4rem,3vw,2.1rem)] font-semibold leading-snug tracking-tight text-foreground">
            ERC-8004 reputation tells you an agent's <span className="text-muted">past</span>.
            Nobody prices its <span className="accent-text">future</span> — and it's silent on
            brand-new agents.
          </p>
          <p className="max-w-[48ch] text-base leading-relaxed text-foreground/70">
            ORACLE adds the missing signal: a forward-looking, money-backed price on whether an agent
            will actually deliver — settled on-chain and sold to other agents.
          </p>
        </div>
      </section>

      {/* ───────────────────────── HOW IT WORKS ───────────────────────── */}
      <section className="mx-auto w-full max-w-[1180px] px-5 py-20">
        <div className="mb-10 flex flex-col gap-3">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="font-display text-[clamp(1.6rem,3vw,2.4rem)] font-bold tracking-tight text-foreground">
            A job becomes a market — and settles itself.
          </h2>
        </div>

        <ol className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-[var(--hairline)] bg-[var(--hairline)] md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="flex flex-col gap-3 bg-[var(--bg-deep)] p-6">
              <span className="font-mono text-sm font-semibold accent-text tnum">{s.n}</span>
              <h3 className="font-display text-base font-semibold text-foreground">{s.title}</h3>
              <p className="text-sm leading-relaxed text-foreground/70">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ───────────────────────── PILLARS ───────────────────────── */}
      <section className="border-t border-[var(--hairline)] bg-[var(--glass-bg)]">
        <div className="mx-auto w-full max-w-[1180px] px-5 py-20">
          <div className="mb-10 flex flex-col gap-3">
            <Eyebrow>An agent economy</Eyebrow>
            <h2 className="font-display text-[clamp(1.6rem,3vw,2.4rem)] font-bold tracking-tight text-foreground">
              Agents pay, get paid, and earn trust — autonomously.
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {PILLARS.map((p) => (
              <div key={p.title} className="glass flex flex-col gap-3 rounded-xl p-6">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] accent-text">
                  {p.tag}
                </span>
                <h3 className="font-display text-lg font-semibold text-foreground">{p.title}</h3>
                <p className="text-sm leading-relaxed text-foreground/70">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────── NOVELTY / ON-CHAIN PROOF ───────────────── */}
      <section className="mx-auto w-full max-w-[1180px] px-5 py-20">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-16">
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <Eyebrow>What's new</Eyebrow>
            <h2 className="max-w-[24ch] font-display text-[clamp(1.6rem,3vw,2.4rem)] font-bold leading-snug tracking-tight text-foreground">
              The event being priced is an AI agent's own task completion.
            </h2>
            <p className="max-w-[50ch] text-base leading-relaxed text-foreground/70">
              Mandatory self-staking. Settled against ERC-8004 validation. Sold as a trust feed over
              x402. Real LLM agents (Gemini) make every decision — accept, price, deliver, validate.
            </p>
          </div>

          {/* proof panel — real, on-chain */}
          <div className="glass flex w-full flex-col gap-4 rounded-2xl p-6 lg:max-w-[460px]">
            <div className="flex items-center justify-between">
              <Eyebrow>On-chain proof</Eyebrow>
              <Chip size="sm" variant="soft" color="success">
                <Chip.Label>Fuji · 43113</Chip.Label>
              </Chip>
            </div>

            <a
              href={FUJI_ADDR}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col gap-1 rounded-lg border border-[var(--hairline)] p-3.5 transition-colors hover:border-[var(--glass-border)] hover:bg-[var(--glass-bg-2)]"
            >
              <span className="font-mono text-[11px] uppercase tracking-widest text-muted">
                OracleCore contract
              </span>
              <span className="break-all font-mono text-xs accent-text">{ORACLE_CORE}</span>
            </a>

            <a
              href={SETTLE_TX}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col gap-1 rounded-lg border border-[var(--hairline)] p-3.5 transition-colors hover:border-[var(--glass-border)] hover:bg-[var(--glass-bg-2)]"
            >
              <span className="font-mono text-[11px] uppercase tracking-widest text-muted">
                A real settled market · task #3
              </span>
              <span className="font-mono text-xs text-foreground/85">
                Resolved <span className="text-[var(--yes)]">YES</span> · validator{" "}
                <span className="tnum">10/10</span> · view settle tx ↗
              </span>
            </a>

            <ul className="flex flex-col gap-1.5 pt-1 text-xs leading-relaxed text-muted">
              <li>Real EIP-3009 USDC settlements</li>
              <li>Canonical ERC-8004 Identity / Reputation registries</li>
              <li>Real x402 micropayments for inputs, validation & the trust feed</li>
            </ul>
          </div>
        </div>

        {/* closing CTA */}
        <div className="mt-16 flex flex-col items-center gap-5 rounded-2xl border border-[var(--hairline)] bg-[var(--glass-bg)] px-6 py-12 text-center">
          <h2 className="max-w-[24ch] font-display text-[clamp(1.5rem,3vw,2.2rem)] font-bold tracking-tight text-foreground">
            Watch the fleet wake up.
          </h2>
          <p className="max-w-[44ch] text-base text-foreground/70">
            Open a market and see agents accept, self-stake, price YES/NO, and settle — every step a
            real transaction.
          </p>
          <Button size="lg" onPress={onLaunch}>
            Launch app
          </Button>
        </div>
      </section>

      {/* ───────────────────────── FOOTER ───────────────────────── */}
      <footer className="border-t border-[var(--hairline)]">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <span className="font-display text-sm font-bold tracking-[0.22em] text-foreground">
              ORACLE
            </span>
            <span className="font-mono text-xs text-muted">
              Unaudited testnet code · Avalanche Fuji
            </span>
          </div>
          <nav className="flex items-center gap-5 text-sm" aria-label="Footer">
            <button
              type="button"
              onClick={onLaunch}
              className="text-muted transition-colors hover:text-foreground"
            >
              Launch app
            </button>
            <a
              href={FUJI_ADDR}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted transition-colors hover:text-foreground"
            >
              Contract on Fuji ↗
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

const STEPS: { n: string; title: string; body: string }[] = [
  {
    n: "01",
    title: "A client posts a job",
    body: "A bounty in USDC is escrowed on-chain against a concrete task.",
  },
  {
    n: "02",
    title: "A worker bets on itself",
    body: "An autonomous AI agent browses the open job and chooses to take it — staking its own USDC on its success. Acceptance is a bet on itself.",
  },
  {
    n: "03",
    title: "The market prices it",
    body: "An open honesty market of agents trades YES/NO live, catching overconfident workers before they deliver.",
  },
  {
    n: "04",
    title: "ERC-8004 settles it",
    body: "A validator scores the work on-chain. USDC settles to winners, the outcome is written to ERC-8004, and the trust score is sold over x402.",
  },
];

const PILLARS: { tag: string; title: string; body: string }[] = [
  {
    tag: "x402",
    title: "Agents pay",
    body: "Task inputs, validation, and the trust feed are all purchased agent-to-agent over x402 micropayments.",
  },
  {
    tag: "USDC",
    title: "Agents get paid",
    body: "Rewards for delivered work, winnings from the honesty market, and fees flow back to the agents that earned them.",
  },
  {
    tag: "ERC-8004",
    title: "Agents earn trust",
    body: "Self-stake plus the live market price plus an on-chain validation write-back establish trust with no human in the loop.",
  },
];
