import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  FlaskConical,
  Play,
  Square,
  Users,
  RefreshCw,
  AlertCircle,
  GitPullRequest,
  ExternalLink,
} from "lucide-react";
import "./lab.css";
const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${n.toFixed(1)}%`;
const number = (n: number | undefined) =>
  n == null ? "—" : n.toLocaleString();
export function TrafficLab() {
  const [status, setStatus] = useState<any>(null),
    [metrics, setMetrics] = useState<any>(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState("");
  const [scenario, setScenario] = useState("healthy"),
    [mode, setMode] = useState("comparison"),
    [rate, setRate] = useState(5),
    [sessions, setSessions] = useState(120),
    [seed, setSeed] = useState("42"),
    [busy, setBusy] = useState(false);
  const selectedRef = useRef("");
  const refreshSequence = useRef(0);
  selectedRef.current = selected;
  async function api(path: string, body?: unknown) {
    const r = await fetch(path, {
      ...(body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Request failed");
    return j;
  }
  async function refresh() {
    const sequence = ++refreshSequence.current;
    try {
      const next = await api("/api/traffic/status");
      if (sequence !== refreshSequence.current) return;
      setStatus(next);
      setError("");
      const run =
        next.runs.find((r: any) => r.id === selectedRef.current) ||
        next.active ||
        next.runs[0];
      if (run) {
        const to = run.finishedAt ?? Date.now();
        const params = new URLSearchParams({
          from: String(run.startedAt),
          to: String(Math.max(run.startedAt + 1, to)),
          runId: run.id,
          includePreview: String(run.options.mode === "comparison"),
        });
        const nextMetrics = await api(`/api/metrics?${params}`);
        if (sequence === refreshSequence.current) setMetrics(nextMetrics);
      } else setMetrics(null);
    } catch (e) {
      if (sequence === refreshSequence.current)
        setError(e instanceof Error ? e.message : "Cannot reach Traffic Lab");
    }
  }
  useEffect(() => {
    document.title = "ReleasePilot · Traffic Lab";
    let running = true;
    let inFlight = false;
    const tick = async () => {
      if (!running || inFlight) return;
      inFlight = true;
      try {
        await refresh();
      } finally {
        inFlight = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 1500);
    return () => {
      running = false;
      clearInterval(timer);
    };
  }, []);
  async function start() {
    setBusy(true);
    try {
      const run = await api("/api/traffic/start", {
        scenario,
        mode,
        rate,
        sessions,
        seed,
      });
      setSelected(run.id);
      selectedRef.current = run.id;
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start");
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    setBusy(true);
    try {
      await api("/api/traffic/stop", {});
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const run =
    status?.runs?.find((r: any) => r.id === selected) ||
    status?.active ||
    status?.runs?.[0];
  const original = metrics?.cohorts.original,
    redesign = metrics?.cohorts.redesign;
  const progress = run?.progress;
  return (
    <div className="lab-page">
      <header className="pilot-header">
        <a href="/lab" className="pilot-brand">
          <span>
            <Activity size={22} />
          </span>
          ReleasePilot<span className="pilot-beta">LOCAL</span>
        </a>
        <div className="pilot-toplinks">
          <a href="/?preview=redesign">
            Open Bite <ExternalLink size={14} />
          </a>
          <a
            href="https://github.com/Harsh16Bhardwaj/releasepilot"
            target="_blank"
            rel="noreferrer"
          >
            Repository <GitPullRequest size={15} />
          </a>
        </div>
      </header>
      <main className="pilot-main">
        <div className="lab-title">
          <div>
            <span className="pilot-eyebrow">
              RELEASE INTELLIGENCE / TRAFFIC LAB
            </span>
            <h1>
              See the change.
              <br />
              <span>Measure the difference.</span>
            </h1>
            <p>
              Repeatable visitors. Real requests. Every decision starts with
              evidence.
            </p>
          </div>
          <div className={"service-badge " + (status ? "online" : "")}>
            <span />
            {status ? "Traffic Lab connected" : "Traffic Lab offline"}
          </div>
        </div>
        <div className="lab-disclosure">
          <FlaskConical size={20} />
          <div>
            <strong>This is a traffic laboratory.</strong>
            <span>
              All visitors are simulated. Comparison mode previews both pages;
              it does not prove Flagsmith exposure or real human preference.
              Automated releases are not connected yet.
            </span>
          </div>
        </div>
        {error && (
          <div className="lab-error" role="alert">
            <AlertCircle size={18} />
            {error}
            <button onClick={() => void refresh()}>
              <RefreshCw size={15} />
              Retry
            </button>
          </div>
        )}
        <div className="lab-stats">
          <Stat
            label="Visitor sessions"
            value={number(progress?.completed)}
            detail={
              run
                ? `${progress?.attempted ?? 0} started / ${run.options.sessions} planned`
                : "Start a run to collect evidence"
            }
            icon={<Users size={19} />}
          />
          <Stat
            label="Original → cart"
            value={pct(original?.cartRatePercent)}
            detail={`${original?.completed ?? 0} completed sessions`}
            icon={<Activity size={19} />}
          />
          <Stat
            label="Redesign → cart"
            value={pct(redesign?.cartRatePercent)}
            detail={`${redesign?.completed ?? 0} completed sessions`}
            icon={<Activity size={19} />}
          />
          <Stat
            label="Cart rate difference"
            value={
              metrics?.comparison.cartDifferencePoints == null
                ? "—"
                : `${metrics.comparison.cartDifferencePoints > 0 ? "+" : ""}${metrics.comparison.cartDifferencePoints.toFixed(1)} pp`
            }
            detail="Redesign minus original · percentage points"
            icon={<ArrowUpRight size={19} />}
          />
        </div>
        <div className="lab-layout">
          <section className="lab-panel lab-controls">
            <div className="panel-heading">
              <span className="panel-number">01</span>
              <div>
                <h2>Set the experiment</h2>
                <p>Choose what your simulated visitors do.</p>
              </div>
            </div>
            <fieldset disabled={!!status?.active || busy}>
              <legend>Visitor behaviour</legend>
              <div className="scenario-options">
                {[
                  ["healthy", "Healthy redesign", "More visitors add to cart."],
                  [
                    "neutral",
                    "No meaningful change",
                    "Both versions behave similarly.",
                  ],
                  [
                    "degraded",
                    "Struggling redesign",
                    "Visitors leave before ordering.",
                  ],
                ].map(([value, title, desc]) => (
                  <label
                    key={value}
                    className={scenario === value ? "chosen" : ""}
                  >
                    <input
                      type="radio"
                      name="scenario"
                      value={value}
                      checked={scenario === value}
                      onChange={() => setScenario(value)}
                    />
                    <div>
                      <strong>{title}</strong>
                      <span>{desc}</span>
                    </div>
                  </label>
                ))}
              </div>
              <label className="lab-field">
                Assignment mode
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="comparison">Comparison preview · 50/50</option>
                  <option value="flagsmith">Actual Flagsmith assignment</option>
                </select>
              </label>
              <p className="field-help">
                {mode === "comparison"
                  ? "Explicitly selects the two preview pages. Excluded from rollout evidence."
                  : "Bite chooses the version using Flagsmith. Without a connection, all visitors receive the safe original."}
              </p>
              <div className="lab-field-row">
                <label className="lab-field">
                  Sessions
                  <input
                    type="number"
                    min={1}
                    max={20000}
                    value={sessions}
                    onChange={(e) => setSessions(Number(e.target.value))}
                  />
                </label>
                <label className="lab-field">
                  Visits / second
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={rate}
                    onChange={(e) => setRate(Number(e.target.value))}
                  />
                </label>
              </div>
              <label className="lab-field">
                Repeatable seed
                <input
                  value={seed}
                  maxLength={100}
                  onChange={(e) => setSeed(e.target.value)}
                />
              </label>
            </fieldset>
            <button
              className="lab-start"
              disabled={busy || !!status?.active || !status}
              onClick={() => void start()}
            >
              <Play size={17} />
              {busy ? "Working…" : "Start simulated traffic"}
            </button>
            <button
              className="lab-stop"
              disabled={busy || !status?.active}
              onClick={() => void stop()}
            >
              <Square size={14} />
              Stop traffic
            </button>
            <p className="lab-small">
              The simulator never tells the metrics service which scenario was
              selected.
            </p>
          </section>
          <div className="lab-results">
            <section className="lab-panel">
              <div className="panel-heading">
                <span className="panel-number">02</span>
                <div>
                  <h2>Read the evidence</h2>
                  <p>Measured from completed visitor sessions.</p>
                </div>
                <span className="window-badge">
                  {metrics?.frozen
                    ? "Frozen window"
                    : run
                      ? "Collecting"
                      : "Waiting"}
                </span>
              </div>
              <div className="comparison-chart">
                <div className="chart-label">
                  <strong>Sessions adding an item to cart</strong>
                  <span>0–100%</span>
                </div>
                {[
                  ["Original", original?.cartRatePercent, "control"],
                  ["Redesign", redesign?.cartRatePercent, "treatment"],
                ].map(([label, value, cls]) => (
                  <div className="chart-row" key={String(label)}>
                    <span>{label}</span>
                    <div>
                      <div
                        className={String(cls)}
                        style={{
                          width: `${typeof value === "number" ? value : 0}%`,
                        }}
                      />
                    </div>
                    <strong>{pct(value as number)}</strong>
                  </div>
                ))}
              </div>
              <div className="metric-table-wrap">
                <table className="metric-table">
                  <thead>
                    <tr>
                      <th>Measurement</th>
                      <th>Original</th>
                      <th>Redesign</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      [
                        "Completed sessions",
                        number(original?.completed),
                        number(redesign?.completed),
                      ],
                      [
                        "Checkout starts",
                        pct(original?.checkoutRatePercent),
                        pct(redesign?.checkoutRatePercent),
                      ],
                      [
                        "Bounce rate",
                        pct(original?.bounceRatePercent),
                        pct(redesign?.bounceRatePercent),
                      ],
                      [
                        "Server error rate (5xx)",
                        pct(original?.errorRatePercent),
                        pct(redesign?.errorRatePercent),
                      ],
                      [
                        "P95 request latency",
                        original?.p95Ms == null
                          ? "—"
                          : `${original.p95Ms.toFixed(1)} ms`,
                        redesign?.p95Ms == null
                          ? "—"
                          : `${redesign.p95Ms.toFixed(1)} ms`,
                      ],
                      [
                        "Requests observed",
                        number(original?.requests),
                        number(redesign?.requests),
                      ],
                    ].map(([label, a, b]) => (
                      <tr key={label}>
                        <td>{label}</td>
                        <td>{a}</td>
                        <td>{b}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="quality-line">
                <CheckCircle2 size={16} />
                <span>
                  {metrics
                    ? `Data: ${metrics.quality.state.replaceAll("_", " ")} · ${metrics.quality.activeSessions} active sessions · ${metrics.freshness.stale ? "historical / stale" : "recent"} · ${metrics.quality.rolloutEligible ? "scoped Flagsmith source" : "not eligible for rollout decisions"}`
                    : "No observations yet. Missing data is never healthy data."}
                </span>
              </div>
            </section>
            <section className="lab-panel">
              <div className="panel-heading">
                <span className="panel-number">03</span>
                <div>
                  <h2>Run history</h2>
                  <p>Saved by the separate simulator process.</p>
                </div>
              </div>
              {status?.runs?.length ? (
                <div className="run-list">
                  {status.runs.map((r: any) => (
                    <button
                      key={r.id}
                      className={run?.id === r.id ? "active" : ""}
                      onClick={() => {
                        setSelected(r.id);
                        selectedRef.current = r.id;
                        void refresh();
                      }}
                    >
                      <span className={"run-indicator " + r.status} />
                      <div>
                        <strong>
                          {r.options.scenario} <small>{r.options.mode}</small>
                        </strong>
                        <span>
                          {new Date(r.startedAt).toLocaleTimeString()} · seed{" "}
                          {r.options.seed} · {r.progress.completed} sessions
                        </span>
                      </div>
                      <span className="run-status">
                        {r.status.replaceAll("_", " ")}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="lab-empty">
                  <FlaskConical size={30} />
                  <strong>Your first run starts here.</strong>
                  <p>
                    Choose a scenario and watch both versions collect evidence.
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
        <footer className="lab-footer">
          ReleasePilot · Local traffic laboratory
          <span>No synthetic data is presented as real customer evidence.</span>
        </footer>
      </main>
    </div>
  );
}
function Stat({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="lab-stat">
      <span>
        {label}
        {icon}
      </span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
