// Agents board for firstmate lanes on crew members. Usage: node board.js <lanes.json> <out.html | out.md> [--watch <seconds>]
// An out path ending in .md writes a Markdown status file instead, for sessions without Lavish.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [configPath, outPath, flag, seconds] = process.argv.slice(2);
if (!configPath || !outPath) {
  console.error("usage: node board.js <lanes.json> <out.html | out.md> [--watch <seconds>]");
  process.exit(2);
}
const interval = flag === "--watch" ? Math.max(5, Number(seconds) || 60) : 0;
const markdown = outPath.toLowerCase().endsWith(".md");

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cut = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "..." : s; };
const clock = (d) => (d ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "unknown");
const mins = (ms) => { const m = Math.round(ms / 60000); return m < 1 ? "under a minute" : m < 60 ? m + " min" : Math.floor(m / 60) + " h " + (m % 60) + " min"; };
const stat = (p) => { try { return fs.statSync(p); } catch { return null; } };
const git = (cwd, args) => { try { return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };

// Claude Code logs a session under <member folder>/projects/<the folder it started in, each non-alphanumeric character as ->.
function transcriptOf(lane) {
  const slug = lane.worktree.replace(/[^A-Za-z0-9]/g, "-");
  const crew = process.env.CREWROTA_HOME || path.join(os.homedir(), ".crewrota");
  const dir = path.join(crew, "members", lane.member, "projects", slug);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(dir, f)); } catch { return null; }
  files = files.map((f) => ({ f, s: fs.statSync(f) })).sort((a, b) => b.s.mtimeMs - a.s.mtimeMs);
  return files[0] || null;
}

function tailLines(file, bytes) {
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - bytes);
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  const lines = buf.toString("utf8").split("\n");
  if (start > 0) lines.shift();
  return lines.filter(Boolean);
}

function stepOf(block, worktree) {
  if (block.type === "text" && block.text && block.text.trim()) return { kind: "Says", text: cut(block.text, 260) };
  if (block.type !== "tool_use") return null;
  const i = block.input || {};
  const rel = (p) => String(p || "").replace(/\\/g, "/").replace(worktree.replace(/\\/g, "/") + "/", "");
  if (block.name === "Bash" || block.name === "PowerShell") return { kind: "Runs", text: cut(i.description || "a shell command", 160) };
  if (["Read", "Write", "Edit", "NotebookEdit"].includes(block.name)) return { kind: block.name === "Read" ? "Reads" : "Writes", text: cut(rel(i.file_path), 160) };
  if (block.name === "Grep" || block.name === "Glob") return { kind: "Searches", text: cut(i.pattern, 120) };
  if (block.name === "TodoWrite") return { kind: "Plans", text: "updates its to-do list" };
  return { kind: "Uses", text: cut(block.name, 80) };
}

function resultOf(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim().startsWith("{"));
  for (const line of lines.reverse()) {
    try { const j = JSON.parse(line); if ("is_error" in j || j.type === "result") return j; } catch {}
  }
  return null; // crewrota notes can come before the result; no result line yet means still running
}

function readLane(lane) {
  const now = Date.now();
  const runJson = path.join(lane.evidence, "run.json");
  const runStat = stat(runJson);
  const tr = transcriptOf(lane);
  const out = { ...lane, steps: [], todos: null, started: runStat ? runStat.birthtime : null };

  if (tr) {
    out.lastActivity = tr.s.mtime;
    out.transcriptKb = Math.round(tr.s.size / 1024);
    for (const line of tailLines(tr.f, 600000)) {
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.type !== "assistant" || !j.message || !Array.isArray(j.message.content)) continue;
      for (const block of j.message.content) {
        if (block.type === "tool_use" && block.name === "TodoWrite" && block.input && Array.isArray(block.input.todos)) out.todos = block.input.todos;
        const step = stepOf(block, lane.worktree);
        if (step) out.steps.push({ ...step, at: j.timestamp ? new Date(j.timestamp) : null });
      }
    }
    out.steps = out.steps.slice(-7).reverse();
  }

  const r = runStat && runStat.size > 0 ? resultOf(runJson) : null;
  if (r) {
    out.state = r.is_error ? "failed" : "finished";
    out.result = r.result || "";
    out.turns = r.num_turns;
    out.duration = r.duration_ms;
    out.session = r.session_id;
    out.ended = runStat.mtime;
  } else if (!runStat) {
    out.state = "not started";
  } else {
    out.quietMs = out.lastActivity ? now - out.lastActivity.getTime() : null;
    out.state = out.quietMs !== null && out.quietMs < 5 * 60000 ? "working" : "quiet";
  }

  out.branch = git(lane.worktree, ["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown";
  out.changed = git(lane.worktree, ["status", "--porcelain"]).split("\n").filter(Boolean);
  try { out.evidenceFiles = fs.readdirSync(lane.evidence).filter((f) => !/^run\.(json|err)$/.test(f)); } catch { out.evidenceFiles = []; }
  out.hasReport = out.evidenceFiles.includes("report.md");
  return out;
}

const BADGE = { working: "badge-info", quiet: "badge-warning", finished: "badge-success", failed: "badge-error", "not started": "badge-ghost" };
const WORD = { working: "Working", quiet: "Quiet", finished: "Finished", failed: "Failed", "not started": "Not started" };
const ORDER = { working: 0, quiet: 1, failed: 2, "not started": 3, finished: 4 }; // running on top, finished at the bottom

function headline(cfg, lanes) {
  const running = lanes.filter((l) => l.state === "working" || l.state === "quiet").length;
  return `${cfg.title || "Agents board"}: ${running ? running + " of " + lanes.length + " lanes still running" : "all " + lanes.length + " lanes have ended"}`;
}

function nextStep(lanes) {
  const quiet = lanes.filter((l) => l.state === "quiet");
  const failed = lanes.filter((l) => l.state === "failed");
  const running = lanes.some((l) => l.state === "working" || l.state === "quiet");
  return failed.length ? `Lane ${failed.map((l) => l.name).join(", ")} failed. Read its run.err and closing summary.`
    : quiet.length ? `Lane ${quiet.map((l) => l.name).join(", ")} has written nothing to its log for over five minutes. A long build or install can do that; past fifteen minutes it is worth a look.`
    : running ? "Nothing. The first mate is told when each lane exits, then checks and joins the results."
    : "All lanes have ended. The first mate reads each report, checks each tree itself, and joins the work.";
}

function summaryLine(l) {
  return `Lane ${l.name} (crew ${l.member}): ${WORD[l.state].toLowerCase()}, ${l.changed.length} file${l.changed.length === 1 ? "" : "s"} changed${l.steps[0] && l.state !== "finished" ? ", last seen: " + l.steps[0].kind.toLowerCase() + " " + cut(l.steps[0].text, 90) : ""}.`;
}

function card(l) {
  const now = Date.now();
  const facts = [
    ["Member", `crew ${esc(l.member)}`],
    ...(l.ship ? [["Ship", esc(l.ship)]] : []),
    ["Branch", esc(l.branch)],
    ["Started", l.started ? `${clock(l.started)} (${mins(now - l.started.getTime())} ago)` : "not yet"],
    l.ended ? ["Ended", `${clock(l.ended)}${l.duration ? ", ran " + mins(l.duration) : ""}${l.turns ? ", " + l.turns + " turns" : ""}`] : ["Last activity", l.lastActivity ? `${clock(l.lastActivity)} (${mins(now - l.lastActivity.getTime())} ago)` : "none seen"],
    ["Log size", l.transcriptKb ? l.transcriptKb.toLocaleString("en-GB") + " KB" : "no log found"],
    ["Tree", `<code>${esc(l.worktree)}</code>`],
    ["Brief", `<code>${esc(l.brief || "none")}</code>`],
    ["Report", l.hasReport ? `<code>${esc(path.join(l.evidence, "report.md"))}</code>` : "not written yet"],
  ];
  const todos = l.todos ? `<h3>Its own to-do list (${l.todos.filter((t) => t.status === "completed").length} of ${l.todos.length} done)</h3><ul class="todo">${l.todos.map((t) => `<li class="${esc(t.status)}"><span class="mark">${t.status === "completed" ? "done" : t.status === "in_progress" ? "now" : "next"}</span>${esc(cut(t.content, 140))}</li>`).join("")}</ul>` : "";
  const steps = l.steps.length ? `<h3>Latest steps, newest first</h3><ol class="steps-list">${l.steps.map((s) => `<li><span class="when">${clock(s.at)}</span><span class="kind">${esc(s.kind)}</span><span>${esc(s.text)}</span></li>`).join("")}</ol>` : `<h3>Latest steps</h3><p class="muted">Nothing in the log yet.</p>`;
  const files = `<h3>Files changed in its tree: ${l.changed.length}</h3>${l.changed.length ? `<ul class="files">${l.changed.slice(0, 16).map((f) => `<li><code>${esc(f)}</code></li>`).join("")}${l.changed.length > 16 ? `<li class="muted">and ${l.changed.length - 16} more</li>` : ""}</ul>` : `<p class="muted">None yet.</p>`}`;
  const evidence = `<h3>Evidence files: ${l.evidenceFiles.length}</h3>${l.evidenceFiles.length ? `<p class="muted">${l.evidenceFiles.slice(0, 12).map(esc).join(", ")}${l.evidenceFiles.length > 12 ? ", ..." : ""}</p>` : ""}`;
  const result = l.result ? `<h3>Its closing summary</h3><pre class="result">${esc(l.result)}</pre>` : "";
  return `<section class="card card-border bg-base-200 lane" data-lane="${esc(l.name)}">
  <div class="card-body">
    <div class="lane-head"><h2 class="card-title">Lane ${esc(l.name)}</h2><span class="badge ${BADGE[l.state]}">${WORD[l.state]}${l.state === "quiet" && l.quietMs ? " for " + mins(l.quietMs) : ""}</span></div>
    <p>${esc(l.job || "")}</p>
    ${l.steps[0] && (l.state === "working" || l.state === "quiet") ? `<div role="status" class="alert alert-soft"><span><b>Doing now:</b> ${esc(l.steps[0].kind)} ${esc(l.steps[0].text)}</span></div>` : ""}
    <dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
    ${result}${todos}${steps}${files}${evidence}
  </div>
</section>`;
}

function page(cfg, lanes) {
  const count = (s) => lanes.filter((l) => l.state === s).length;
  const generated = new Date();
  return `<!doctype html>
<html lang="en" data-theme="dark" data-lavish-annotate="off">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agents board - ${esc(cfg.title || "firstmate")}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/daisyui@5.5.19/daisyui.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/daisyui@5.5.19/themes.css">
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.2.4/dist/index.global.js"></script>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { background: var(--color-base-100); color: var(--color-base-content); margin: 0; }
  .wrap { width: 100%; padding: 24px 28px 48px; }
  .grid-lanes { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); }
  @media (min-width: 1100px) { .grid-lanes { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .lane-head { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px 20px; margin: 4px 0; }
  .facts dt { font-size: 12px; opacity: .7; }
  .facts dd { margin: 0; overflow-wrap: anywhere; }
  h3 { font-weight: 600; margin-top: 14px; font-size: 14px; }
  code { font-size: 12px; overflow-wrap: anywhere; }
  .muted { opacity: .7; font-size: 13px; overflow-wrap: anywhere; }
  .steps-list, .files, .todo { list-style: none; padding: 0; margin: 6px 0 0; display: grid; gap: 4px; }
  .steps-list li { display: grid; grid-template-columns: 48px 76px minmax(0, 1fr); gap: 8px; font-size: 13px; overflow-wrap: anywhere; }
  .when { opacity: .6; font-variant-numeric: tabular-nums; }
  .kind { font-weight: 600; }
  .todo li { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 8px; font-size: 13px; }
  .todo .mark { font-size: 11px; opacity: .75; text-transform: uppercase; }
  .todo .completed { opacity: .6; }
  .todo .in_progress { font-weight: 600; }
  .result { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; background: var(--color-base-300); padding: 12px; border-radius: 8px; max-height: 320px; overflow: auto; }
  .lead { border: 2px solid var(--color-primary); border-radius: 12px; padding: 18px 22px; background: var(--color-base-200); margin-bottom: 22px; }
  .lead ol { margin: 8px 0 0 18px; list-style: decimal; display: grid; gap: 4px; }
  .stats { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
</style>
</head>
<body>
<main class="wrap">
  <section class="lead" data-part="summary">
    <p class="text-sm opacity-70">60-second version</p>
    <h1 class="text-2xl font-bold">${esc(headline(cfg, lanes))}</h1>
    <ol>
      ${lanes.map((l) => `<li>${esc(summaryLine(l))}</li>`).join("")}
    </ol>
    <p class="mt-3"><b>What to do:</b> ${esc(nextStep(lanes))}</p>
    <div class="stats">
      <span class="badge badge-info">Working ${count("working")}</span><span class="badge badge-warning">Quiet ${count("quiet")}</span><span class="badge badge-success">Finished ${count("finished")}</span><span class="badge badge-error">Failed ${count("failed")}</span>
      <span class="badge badge-ghost" id="age" data-at="${generated.toISOString()}" data-every="${interval}">Snapshot taken ${clock(generated)}</span>
    </div>
    <p class="muted mt-2">Everything below is read from each lane's own files. This page only reads; it cannot stop or steer a lane.</p>
  </section>
  <div class="grid-lanes">${[...lanes].sort((a, b) => ORDER[a.state] - ORDER[b.state]).map(card).join("\n")}</div>
  <section class="mt-6 muted" data-part="how">
    <p>How this page is made: <code>board.js</code> reads each lane's session log, its tree's git status, its evidence folder and its <code>run.json</code>, then rewrites this file${interval ? " every " + interval + " seconds until every lane has ended" : " once"}. Step lines show what a tool call was for, never its output. Plan: <code>${esc(cfg.plan || "not given")}</code></p>
  </section>
</main>
<script>
  const age = document.getElementById("age");
  const at = new Date(age.dataset.at).getTime(), every = Number(age.dataset.every) || 0;
  const tick = () => {
    const s = Math.round((Date.now() - at) / 1000);
    const stale = every ? s > every * 3 : s > 120;
    age.textContent = "Snapshot " + (s < 60 ? s + " s" : Math.round(s / 60) + " min") + " old" + (stale ? " - not refreshing" : "");
    age.className = "badge " + (stale ? "badge-warning" : "badge-ghost");
  };
  tick(); setInterval(tick, 5000);
</script>
</body>
</html>`;
}

function statusFile(cfg, lanes) {
  const lines = [`# ${headline(cfg, lanes)}`, "", `Snapshot ${new Date().toISOString()}. Plan: ${cfg.plan || "not given"}`, ""];
  for (const l of lanes) lines.push(`- ${summaryLine(l)}`);
  lines.push("", `What to do: ${nextStep(lanes)}`, "");
  for (const l of [...lanes].sort((a, b) => ORDER[a.state] - ORDER[b.state])) {
    lines.push(`## Lane ${l.name}: ${WORD[l.state]}`, "", l.job || "", "");
    lines.push(`- Member: crew ${l.member}${l.ship ? `, ship ${l.ship}` : ""}`, `- Branch: ${l.branch}`, `- Tree: ${l.worktree}`, `- Brief: ${l.brief || "none"}`);
    lines.push(`- Report: ${l.hasReport ? path.join(l.evidence, "report.md") : "not written yet"}`, `- Files changed: ${l.changed.length}`, "");
    if (l.result) lines.push("Closing summary:", "", ...l.result.split(/\r?\n/).map((line) => `> ${line}`), "");
  }
  return lines.join("\n");
}

function build() {
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const lanes = cfg.lanes.map(readLane);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath + ".tmp", markdown ? statusFile(cfg, lanes) : page(cfg, lanes));
  fs.renameSync(outPath + ".tmp", outPath);
  return lanes;
}

const lanes = build();
console.log(lanes.map((l) => `${l.name}: ${l.state}`).join(" | "));
if (interval) {
  const timer = setInterval(() => {
    const now = build();
    if (now.every((l) => l.state === "finished" || l.state === "failed")) {
      console.log("all lanes ended: " + now.map((l) => `${l.name}: ${l.state}`).join(" | "));
      clearInterval(timer);
    }
  }, interval * 1000);
}
