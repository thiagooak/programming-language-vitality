#!/usr/bin/env node

import "dotenv/config";
import { Octokit } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";
import fs from "fs";
import path from "path";

const LANGUAGES = [
  "clojure",
  "elixir",
  "zig",
  "ocaml",
  //"erlang",
  //"coffeescript",
  //"scheme",
  //"lua",
  //"objective-c",
  //"julia",
  //"haskell",
  //"scala",
];

const LANGUAGE_START = {
  clojure: "2008-12-31",
  elixir:  "2012-01-01",
  zig:     "2015-12-31",
  erlang:  "2008-12-31",
  haskell: "2008-12-31",
  scala:   "2008-12-31",
  ocaml:   "2008-12-31",
  lua:           "2019-01-01",
  coffeescript:  "2019-01-01",
  scheme:  "2019-01-01",
  "objective-c": "2019-01-01",
  "julia":       "2019-01-01",
};

const CONFIG = {
  token:            process.env.GITHUB_TOKEN,
  perPage:          100,
  endDate:          "2026-05-01",
  initialIncrement: 30,
  tooFewThreshold:  500,
  growFactor:       1.5,
  shrinkFactor:     0.5,
};

// ─── Date helpers ─────────────────────────────────────────────────────────────

function dateAdd(dateStr, days) {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function minDate(a, b) {
  return a < b ? a : b;
}

// ─── Cache helpers ─────────────────────────────────────────────────────────────

function cacheDir(language) {
  return `raw/${language}`;
}

function cacheFile(language, start, end) {
  return path.join(cacheDir(language), `${start}..${end}.json`);
}

function writeCache(filePath, repos, language) {
  const cache = { timestamp: Date.now(), language, repos };
  fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), "utf8");
  console.log(`💾  Saved → ${path.resolve(filePath)}`);
}

function loadCacheFiles(language) {
  const dir = cacheDir(language);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map(f => ({ start: f.slice(0, 10), end: f.slice(12, 22) }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

// Returns all gaps in [startDate, endDate) not covered by the sorted file ranges.
function computeGaps(files, startDate, endDate) {
  const gaps = [];
  let cursor = startDate;
  for (const f of files) {
    if (f.start > cursor) gaps.push({ start: cursor, end: f.start });
    if (f.end > cursor) cursor = f.end;
  }
  if (cursor < endDate) gaps.push({ start: cursor, end: endDate });
  return gaps;
}

// Returns the date from which fetching should resume (end of contiguous coverage).
function coverageEnd(language) {
  const files = loadCacheFiles(language);
  if (files.length === 0) return LANGUAGE_START[language];
  const gaps = computeGaps(files, files[0].start, CONFIG.endDate);
  return gaps.length > 0 ? gaps[0].start : CONFIG.endDate;
}

// ─── GitHub fetcher ────────────────────────────────────────────────────────────

// Returns { repos, totalCount } on success, or { tooMany: true, totalCount } if
// total_count > 1000 (GitHub's hard cap) — caller should shrink the range and retry.
async function fetchRepos(octokit, language, range) {
  const baseQuery = { q: `language:${language} created:${range}`, sort: "stars", order: "desc", per_page: CONFIG.perPage };

  const { data: first } = await octokit.rest.search.repos({ ...baseQuery, page: 1 });

  if (first.total_count > 1000) {
    return { tooMany: true, totalCount: first.total_count };
  }

  const allRepos = [...first.items];
  let page = 2;

  while (allRepos.length < first.total_count && first.items.length === CONFIG.perPage) {
    const { data } = await octokit.rest.search.repos({ ...baseQuery, page });
    if (data.items.length === 0) break;
    allRepos.push(...data.items);
    console.log(`   Page ${page}: +${data.items.length} (${allRepos.length}/${first.total_count})`);
    if (data.items.length < CONFIG.perPage) break;
    page++;
  }

  return { repos: allRepos, totalCount: first.total_count };
}

// ─── Display summary ──────────────────────────────────────────────────────────

function printSummary(language, repos) {
  if (repos.length === 0) {
    console.log("  ⚠️  No repositories found.");
    return;
  }
  const totalStars = repos.reduce((s, r) => s + r.stargazers_count, 0);
  const top5 = repos.slice(0, 5);
  console.log(`\n  📊  ${language.toUpperCase()} — ${repos.length} repos, ${totalStars.toLocaleString()} total stars`);
  top5.forEach((repo, i) => {
    console.log(`     ${i + 1}. ${repo.full_name.padEnd(45)} ⭐ ${repo.stargazers_count.toLocaleString()}`);
  });
  console.log("");
}

// ─── Coverage report ─────────────────────────────────────────────────────────

function reportCoverage(language) {
  const files = loadCacheFiles(language);
  const rangeStart = LANGUAGE_START[language];

  if (files.length === 0) {
    console.log("  no cached files");
    return;
  }

  const gaps = computeGaps(files, rangeStart, CONFIG.endDate);
  const totalDays = Math.round((new Date(CONFIG.endDate) - new Date(rangeStart)) / 86400000);
  const gapDays = gaps.reduce((s, g) =>
    s + Math.round((new Date(g.end) - new Date(g.start)) / 86400000), 0);

  console.log(`  ${files.length} files, ${totalDays - gapDays}/${totalDays} days covered`);
  if (gaps.length === 0) {
    console.log("  ✅  No gaps.");
  } else {
    console.log(`  ⚠️  ${gaps.length} gap(s):`);
    for (const g of gaps) {
      const days = Math.round((new Date(g.end) - new Date(g.start)) / 86400000);
      console.log(`     ${g.start}..${g.end}  (${days}d)`);
    }
  }
}

// ─── Adaptive fetch loop ──────────────────────────────────────────────────────

async function fetchLanguage(octokit, language) {
  fs.mkdirSync(cacheDir(language), { recursive: true });

  const resume = coverageEnd(language);
  console.log(`\n${"─".repeat(56)}`);
  console.log(`🌐  ${language.toUpperCase()}  —  resuming from ${resume}`);
  console.log(`${"─".repeat(56)}`);

  let start = resume;
  let increment = CONFIG.initialIncrement;

  while (start < CONFIG.endDate) {
    const end = minDate(dateAdd(start, increment), CONFIG.endDate);
    const file = cacheFile(language, start, end);

    if (fs.existsSync(file)) {
      start = end;
      continue;
    }

    const rangeStr = `${start}..${end}`;
    console.log(`\n🔍  ${language}  ${rangeStr}  (window: ${increment}d)`);

    const result = await fetchRepos(octokit, language, rangeStr);

    if (result.tooMany) {
      const next = Math.max(1, Math.floor(increment * CONFIG.shrinkFactor));
      console.log(`📉  ${result.totalCount} results > 1000 — shrinking ${increment}d → ${next}d`);
      increment = next;
      continue;
    }

    writeCache(file, result.repos, language);

    if (result.totalCount < CONFIG.tooFewThreshold) {
      const next = Math.round(increment * CONFIG.growFactor);
      console.log(`📈  ${result.totalCount} results < ${CONFIG.tooFewThreshold} — growing ${increment}d → ${next}d`);
      increment = next;
    }

    start = end;
  }

  console.log(`\n✅  ${language.toUpperCase()} complete.`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (process.argv.includes("--coverage")) {
    for (const language of LANGUAGES) {
      console.log(`\n${"─".repeat(56)}`);
      console.log(`📋  ${language.toUpperCase()}`);
      console.log(`${"─".repeat(56)}`);
      reportCoverage(language);
    }
    return;
  }

  const ThrottledOctokit = Octokit.plugin(throttling);
  const octokit = new ThrottledOctokit({
    auth: CONFIG.token,
    throttle: {
      onRateLimit(retryAfter, options, _octokit, retryCount) {
        console.warn(`⚠️  Rate limit — retrying after ${retryAfter}s (attempt ${retryCount + 1})`);
        return retryCount < 3;
      },
      onSecondaryRateLimit(_retryAfter, options) {
        console.warn(`⚠️  Secondary rate limit for ${options.method} ${options.url}`);
        return true;
      },
    },
  });

  for (const language of LANGUAGES) {
    await fetchLanguage(octokit, language);
  }

  console.log("\n🎉  All languages done.");
}

main().catch((err) => {
  console.error("❌  Fatal:", err.message ?? err);
  process.exit(1);
});
