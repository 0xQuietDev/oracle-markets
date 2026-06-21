// MARKETS (home): a responsive grid of market cards, one per task. A header
// with the section title + a "+ New market" affordance. Empty state is a real
// invitation. Clicking a card opens its detail view.

import type { ControlLoad } from "../useControl.js";
import type { StoreState } from "../types.js";
import { MarketCard } from "./MarketCard.js";
import { NewMarketControl } from "./NewMarketControl.js";

export function MarketsView({
  state,
  now,
  control,
  onOpen,
}: {
  state: StoreState;
  now: number;
  control: ControlLoad;
  onOpen: (id: number) => void;
}) {
  const ids = state.order;

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 px-5 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-display text-xl font-bold tracking-tight text-foreground">Markets</h1>
          <p className="text-sm text-muted">
            Live prediction markets on whether AI workers deliver their tasks.
          </p>
        </div>
        <NewMarketControl control={control} />
      </div>

      {ids.length === 0 ? (
        <div className="glass flex h-72 flex-col items-center justify-center gap-2 rounded-2xl text-center">
          <span className="font-display text-lg font-semibold text-foreground/85">
            No markets yet
          </span>
          <span className="max-w-sm text-sm text-muted">
            Open one to wake the agent fleet — they'll accept, price, and settle it on-chain.
          </span>
          <div className="mt-3">
            <NewMarketControl control={control} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ids.map((id) => {
            const entry = state.tasks[id];
            if (!entry) return null;
            return <MarketCard key={id} entry={entry} now={now} onOpen={onOpen} />;
          })}
        </div>
      )}
    </div>
  );
}
