// The bundled mini-explorer in a HeroUI Drawer (controlled, slides from the
// right). Fetches GET /v1/tx/:hash and renders the decoded TxReceiptView:
// status, block, from/to, gasUsed, and a HeroUI Table of decoded events + args.
// This is the "real on-chain" proof — anvil has no public explorer.

import { Chip, Drawer, Spinner, Table } from "@heroui/react";
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
      .then((receipt) => !cancelled && setLoad({ status: "ok", receipt }))
      .catch((e: unknown) => {
        if (!cancelled)
          setLoad({ status: "error", message: e instanceof Error ? e.message : "fetch failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [txHash]);

  return (
    <Drawer.Backdrop variant="blur" isOpen onOpenChange={(o) => !o && onClose()}>
      <Drawer.Content placement="right" className="w-full max-w-[460px]">
        <Drawer.Dialog>
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs uppercase tracking-widest text-muted">
                mini-explorer · on-chain receipt
              </span>
              <Drawer.Heading className="font-mono text-base">{shortHash(txHash)}</Drawer.Heading>
            </div>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-4">
            {load.status === "loading" && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Spinner size="sm" /> decoding receipt…
              </div>
            )}
            {load.status === "error" && (
              <div className="rounded-lg bg-danger/10 p-3 text-sm text-danger">
                Could not load receipt: {load.message}
                <div className="mt-1 break-all font-mono text-xs opacity-70">{txHash}</div>
              </div>
            )}
            {load.status === "ok" && <Receipt r={load.receipt} />}
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}

function Receipt({ r }: { r: TxReceiptView }) {
  const ok = r.status === "success";
  return (
    <>
      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-sm tnum">
        <dt className="text-muted">status</dt>
        <dd>
          <Chip size="sm" variant="soft" color={ok ? "success" : "danger"}>
            <Chip.Label>{ok ? "✓ success" : "✗ reverted"}</Chip.Label>
          </Chip>
        </dd>
        <dt className="text-muted">block</dt>
        <dd className="font-mono">#{r.blockNumber}</dd>
        <dt className="text-muted">from</dt>
        <dd className="font-mono">{shortHash(r.from)}</dd>
        <dt className="text-muted">to</dt>
        <dd className="font-mono">{r.to ? shortHash(r.to) : "(contract creation)"}</dd>
        <dt className="text-muted">gas used</dt>
        <dd className="font-mono">{Number(r.gasUsed).toLocaleString("en-US")}</dd>
      </dl>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          decoded events ({r.events.length})
        </span>
        {r.events.length === 0 && <p className="text-sm text-muted">no decoded events</p>}
        {r.events.map((ev, i) => (
          <div key={i} className="rounded-lg bg-surface-secondary p-2 ring-1 ring-default/40">
            <div className="mb-1 font-mono text-sm font-semibold text-accent">{ev.name}</div>
            <Table variant="secondary" className="text-xs">
              <Table.ScrollContainer>
                <Table.Content aria-label={`${ev.name} args`}>
                  <Table.Header>
                    <Table.Column isRowHeader>arg</Table.Column>
                    <Table.Column>value</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {Object.entries(ev.args).map(([k, v]) => (
                      <Table.Row key={k}>
                        <Table.Cell className="text-muted">{k}</Table.Cell>
                        <Table.Cell className="break-all font-mono">{v}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </div>
        ))}
      </div>
    </>
  );
}
