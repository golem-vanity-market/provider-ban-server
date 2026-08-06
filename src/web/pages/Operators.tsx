import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.ts";
import type { OperatorsResponse } from "../../shared/types.ts";
import StatTile from "../components/StatTile.tsx";
import WindowPicker from "../components/WindowPicker.tsx";
import { fmtAgo, fmtEff, fmtGlm, fmtHours, fmtWork, shortId } from "../format.ts";
import { WINDOW_PARAM, useWindowKey } from "../window.ts";

// Earnings per operator (payout wallet): what their providers computed, what
// they invoiced, and what actually got paid. "Est. cost" accrues from debit
// notes (the estimators); "Paid" counts on-chain transfers to the wallet.

export default function Operators() {
  const windowKey = useWindowKey();
  const [data, setData] = useState<OperatorsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let stop = false;
    const load = () => {
      api
        .operators(WINDOW_PARAM[windowKey])
        .then((r) => {
          if (!stop) {
            setData(r);
            setError(null);
          }
        })
        .catch((e: Error) => !stop && setError(e.message));
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [windowKey]);

  const toggle = (wallet: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(wallet)) next.delete(wallet);
      else next.add(wallet);
      return next;
    });

  if (error) {
    return (
      <div className="card p-4 text-sm" style={{ color: "var(--status-critical)" }}>
        Failed to load operators: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="text-sm" style={{ color: "var(--text-muted)" }}>
        Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">Operator earnings</h2>
        <WindowPicker />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          label="Operators"
          value={data.totals.operators}
          sub={`${data.totals.providers} providers`}
        />
        <StatTile label="Work" value={fmtWork(data.totals.work)} />
        <StatTile
          label="Est. cost"
          value={fmtGlm(data.totals.cost, 2)}
          sub="debit-note accrual"
        />
        <StatTile label="Invoiced" value={fmtGlm(data.totals.invoiced, 2)} />
        <StatTile
          label="Accepted"
          value={fmtGlm(data.totals.accepted, 2)}
          sub="incl. settled"
        />
        <StatTile
          label="Paid"
          value={fmtGlm(data.totals.paid, 2)}
          sub="on-chain transfers"
        />
      </div>
      <div className="card p-4">
        <div className="overflow-x-auto">
          <table className="data w-full">
            <thead>
              <tr>
                <th>Operator wallet</th>
                <th>Providers</th>
                <th>Agreements</th>
                <th>Work</th>
                <th>Est. cost</th>
                <th>TH/GLM</th>
                <th>Hours</th>
                <th>Invoiced</th>
                <th>Accepted</th>
                <th>Settled</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {data.operators.map((o) => {
                const key = o.wallet ?? "unknown";
                const expanded = open.has(key);
                return (
                  <Fragment key={key}>
                    <tr
                      onClick={() => toggle(key)}
                      style={{ cursor: "pointer" }}
                      title="Click to show this operator's providers"
                    >
                      <td className="font-medium">
                        <span style={{ color: "var(--text-muted)" }}>
                          {expanded ? "▾ " : "▸ "}
                        </span>
                        {o.wallet ? (
                          <span title={o.wallet}>{shortId(o.wallet)}</span>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>
                            unknown wallet
                          </span>
                        )}
                      </td>
                      <td>{o.providers.length}</td>
                      <td>{o.agreements}</td>
                      <td>{fmtWork(o.work)}</td>
                      <td>{fmtGlm(o.cost)}</td>
                      <td>{fmtEff(o.efficiency)}</td>
                      <td>{fmtHours(o.hours)}</td>
                      <td>
                        {fmtGlm(o.invoiced)}
                        {o.invoiceCount > 0 && (
                          <span
                            className="text-xs"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {" "}
                            ({o.invoiceCount})
                          </span>
                        )}
                      </td>
                      <td>{fmtGlm(o.accepted)}</td>
                      <td>{fmtGlm(o.settled)}</td>
                      <td>{fmtGlm(o.paid)}</td>
                    </tr>
                    {expanded &&
                      o.providers.map((p) => (
                        <tr
                          key={p.providerId}
                          style={{ background: "var(--surface-1)" }}
                        >
                          <td className="pl-8">
                            <Link
                              to={`/providers/${p.providerId}`}
                              className="ext-link"
                            >
                              {p.name ?? shortId(p.providerId)}
                            </Link>
                            <div
                              className="text-xs"
                              style={{ color: "var(--text-muted)" }}
                            >
                              {shortId(p.providerId)} · seen{" "}
                              {fmtAgo(p.lastSeen)}
                            </div>
                          </td>
                          <td />
                          <td>{p.agreements}</td>
                          <td>{fmtWork(p.work)}</td>
                          <td>{fmtGlm(p.cost)}</td>
                          <td>{fmtEff(p.efficiency)}</td>
                          <td>{fmtHours(p.hours)}</td>
                          <td>
                            {fmtGlm(p.invoiced)}
                            {p.invoiceCount > 0 && (
                              <span
                                className="text-xs"
                                style={{ color: "var(--text-muted)" }}
                              >
                                {" "}
                                ({p.invoiceCount})
                              </span>
                            )}
                          </td>
                          <td>{fmtGlm(p.accepted)}</td>
                          <td>{fmtGlm(p.settled)}</td>
                          <td style={{ color: "var(--text-muted)" }}>
                            per wallet
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
              {data.operators.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ color: "var(--text-muted)" }}>
                    No activity in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          Est. cost = GLM accrued per the stones&apos; estimators (debit
          notes). Invoiced/Accepted/Settled come from the yagna payment API
          (collected since Aug 2026). Paid = on-chain transfers to the wallet;
          payments are batched per wallet, so there is no per-provider split.
        </div>
      </div>
    </div>
  );
}
