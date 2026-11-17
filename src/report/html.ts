/**
 * One standalone HTML page per run, for a reader with no context: short first,
 * details on demand. No scripts and no external resources; everything from tickets,
 * specs and events is escaped.
 */
import type { Report, TicketReport } from "./build.js";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const num = (n: number) => n.toLocaleString("en-US");

/** "2026-11-17T09:20:41.990Z" -> "2026-11-17 09:20 UTC" */
const when = (iso: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : iso);

function duration(seconds: number | null): string {
  if (seconds === null) return "–";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

const link = (url: string | null, text: string) =>
  url && /^https?:\/\//.test(url) ? `<a href="${esc(url)}">${esc(text)}</a>` : esc(text);

const CSS = `
:root { --bg:#fbfaf8; --card:#fff; --text:#1d1d1f; --muted:#6b6b70; --line:#e4e2dd;
  --pass:#1f7a3d; --fail:#b42318; --warn:#9a6700; --chip:#f1efea; }
@media (prefers-color-scheme: dark) { :root { --bg:#161618; --card:#1f1f22; --text:#ececee;
  --muted:#a0a0a8; --line:#33333a; --pass:#4cc27a; --fail:#ff7b6e; --warn:#e6b450; --chip:#2a2a2f; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text);
  font:15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width: 920px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 26px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 36px 0 12px; }
h3 { font-size: 17px; margin: 0; } h4 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em;
  color: var(--muted); margin: 18px 0 6px; }
.muted { color: var(--muted); }
.tiles { display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
.tile { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
.tile b { display:block; font-size: 22px; font-variant-numeric: tabular-nums; }
.tile span { color: var(--muted); font-size: 13px; }
.ticket { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px 20px; margin: 14px 0; }
.ticket header { display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
.badge { font-size:12px; padding:2px 8px; border-radius:999px; background:var(--chip); }
.s-review .badge, .s-done .badge { color: var(--pass); } .s-blocked .badge { color: var(--fail); }
.s-in_progress .badge { color: var(--warn); }
.prose { white-space: pre-wrap; overflow-wrap: anywhere; }
table { width:100%; border-collapse: collapse; font-size: 14px; }
td, th { text-align:left; padding:6px 8px; border-top:1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 500; }
td code { overflow-wrap: anywhere; }
td:last-child { white-space: nowrap; }
.pass { color: var(--pass); } .fail { color: var(--fail); } .skipped, .not-run { color: var(--muted); }
details { margin-top: 16px; } summary { cursor: pointer; color: var(--muted); }
pre { white-space: pre-wrap; background: var(--chip); padding: 10px 12px; border-radius: 8px; font-size: 13px; }
a { color: inherit; }
`;

function section(title: string, body: string): string {
  return body ? `<h4>${esc(title)}</h4><div class="prose">${esc(body)}</div>` : "";
}

function card(t: TicketReport): string {
  const meta = [
    t.mode,
    t.branch ? `branch ${t.branch}` : null,
    `${t.attempts} attempt${t.attempts === 1 ? "" : "s"}`,
    `${t.evalCount} eval${t.evalCount === 1 ? "" : "s"}`,
    t.tokens ? `${num(t.tokens)} tokens` : null,
  ]
    .filter(Boolean)
    .map((s) => esc(s!))
    .join(" · ");

  const checks = t.checks.length
    ? `<table><tr><th>Check</th><th>Type</th><th>Runs</th><th>Result</th></tr>${t.checks
        .map(
          (c) =>
            `<tr><td>${esc(c.id)}</td><td>${esc(c.type)}</td><td><code>${esc(c.run)}</code></td>` +
            `<td class="${c.status.replace(" ", "-")}">${esc(c.status)}</td></tr>`,
        )
        .join("")}</table>`
    : `<p class="muted">No checks recorded.</p>`;

  return `<article class="ticket s-${esc(t.status)}">
<header><h3>${esc(t.id)} · ${esc(t.title)}</h3><span class="badge">${esc(t.status.replace("_", " "))}</span></header>
<p class="muted">${meta}${t.pr ? ` · ${link(t.pr, "Pull request")}` : ""}</p>
${t.blockedReason && t.status === "blocked" ? `<p class="fail">Blocked: ${esc(t.blockedReason)}</p>` : ""}
${section("Summary", t.goal)}
<h4>Eval</h4>${checks}
${section("Done means", t.doneMeans)}
${section("Decisions made for you", t.decisions)}
${section("Unusual cases and what to check by hand", t.unusual)}
<details><summary>Ask about this</summary><pre>${esc(t.ask)}</pre></details>
</article>`;
}

export function renderReportHtml(r: Report): string {
  const s = r.summary;
  const tiles: [string, string][] = [
    ["Shipped (PR open)", `${s.shipped} / ${s.tickets}`],
    ["Blocked", String(s.blocked)],
    ["In progress", String(s.inProgress)],
    ["Not started", String(s.notStarted)],
    ["Passed eval first try", String(s.firstTryPass)],
    ["Questions asked", String(s.questions)],
    ["Tokens reported", num(s.tokens)],
    ["Time", duration(s.durationSeconds)],
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Super Agent run ${esc(r.run.id)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>Super Agent run ${esc(r.run.id)}</h1>
<p class="muted">Generated ${esc(when(r.run.generatedAt))} · ${num(s.tickets)} tickets · max ${r.run.maxWorkers} workers · budget ${num(r.run.budgetTokens)} tokens</p>
<div class="tiles">${tiles.map(([label, value]) => `<div class="tile"><b>${esc(value)}</b><span>${esc(label)}</span></div>`).join("")}</div>
<h2>What went wrong</h2>
${r.wentWrong.length ? `<ul>${r.wentWrong.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : `<p class="muted">Nothing: every started ticket passed its eval on the first try.</p>`}
<h2>Tickets</h2>
${r.tickets.length ? r.tickets.map(card).join("\n") : `<p class="muted">No tickets yet.</p>`}
</main>
</body>
</html>
`;
}
