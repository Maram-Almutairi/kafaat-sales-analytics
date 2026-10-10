/* Kafaat sales dashboard - runs fully in the browser.
 *
 * - Loads data/Kafaat.csv (raw) or a user CSV / Excel file (never sent anywhere).
 * - Cleans it with the same rules as scripts/utils.py -> clean_raw().
 * - Renders KPIs, charts and tables as plain HTML / SVG (no chart library).
 *
 * Security: every value coming from a file is escaped before it is put in
 * the page (esc()), so a crafted file cannot inject markup or script.
 */
"use strict";
(() => {
  // ---------------------------------------------------------------- config
  const FIELDS = ["Date", "City", "Rep", "Store", "Prod", "Cost", "Sale"];
  const DIMS = ["City", "Rep", "Store", "Prod"];
  const NAME_FIXES = { Rep: { Mjeeed: "Mjeed" }, Store: { "Lulu Hyper": "Lulu" } };
  const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
  const DAY = 864e5;
  const IQR_K = 3;
  const LOW_MARGIN = 15;
  const NONE = "";

  // Validated categorical slots (dataviz reference palette) + neutral "Other"
  const CAT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];
  const OTHER = "#B9AFC9";
  // Sequential ramp: one hue (portfolio violet), light -> dark
  const RAMP = ["#F3ECFE", "#E4D6FB", "#D2BCF7", "#BC9DF1", "#A47FEA", "#8B60E0", "#7445D3", "#5E31BE", "#4F23A8"];

  const GUESSES = {
    Date: ["date", "orderdate", "invoicedate", "transactiondate", "day", "التاريخ", "تاريخ"],
    Sale: ["sale", "sales", "revenue", "amount", "price", "total", "salesamount", "المبيعات", "البيع"],
    Cost: ["cost", "costs", "cogs", "totalcost", "التكلفة", "الكلفة"],
    City: ["city", "region", "area", "location", "المدينة", "المنطقة"],
    Rep: ["rep", "salesrep", "salesperson", "employee", "agent", "seller", "المندوب", "البائع"],
    Store: ["store", "branch", "shop", "customer", "client", "outlet", "المتجر", "الفرع", "العميل"],
    Prod: ["prod", "product", "category", "item", "sku", "المنتج", "الفئة", "الصنف"],
  };
  const FIELD_LABELS = {
    Date: "Date", Sale: "Sale amount", Cost: "Cost",
    City: "Group 1 (e.g. city)", Rep: "Group 2 (e.g. rep)", Store: "Group 3 (e.g. store)", Prod: "Group 4 (e.g. product)",
  };
  const SAMPLE_LABELS = { City: "City", Rep: "Rep", Store: "Store", Prod: "Product" };

  // ---------------------------------------------------------------- helpers
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = (v) => nf0.format(v);
  const fmtK = (v) => {
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return nf0.format(v / 1e3) + "K";
    return nf0.format(v);
  };
  const pct = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) + "%" : "–");
  const sum = (arr, f) => arr.reduce((s, r) => s + f(r), 0);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
  const ymLabel = (ym) => MONTHS[+ym.slice(5, 7) - 1] + " " + ym.slice(0, 4);
  const svgEl = (w, h, inner) => `<svg viewBox="0 0 ${w} ${h}" role="img">${inner}</svg>`;

  // ---------------------------------------------------------------- tooltip
  const tips = new WeakMap();
  const tip = $("tip");
  document.addEventListener("mousemove", (e) => {
    let el = e.target;
    while (el && el !== document && !tips.has(el)) el = el.parentNode;
    if (!el || el === document) { tip.hidden = true; return; }
    tip.innerHTML = tips.get(el);
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  });
  document.addEventListener("scroll", () => { tip.hidden = true; }, { passive: true });
  const bindTips = (root, selector, html) => root.querySelectorAll(selector).forEach((el, i) => tips.set(el, html(i)));

  // ---------------------------------------------------------------- parsing
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const firstLine = text.split(/\r?\n/, 1)[0];
    const delim = [",", ";", "\t", "|"].map((d) => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === delim) { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
  }

  function toObjects(table) {
    const seen = {};
    const headers = table[0].map((h, i) => {
      let name = String(h ?? "").trim() || `Column ${i + 1}`;
      if (seen[name]) name += ` (${++seen[name]})`; else seen[name] = 1;
      return name;
    });
    const rows = table.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] == null ? "" : String(r[i])])));
    return { headers, rows };
  }

  async function readFile(file) {
    const buf = await file.arrayBuffer();
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      if (!window.XLSX) throw new Error("Excel reader failed to load.");
      const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      return toObjects(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }));
    }
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("�")) text = new TextDecoder("windows-1256").decode(buf);
    const table = parseCSV(text);
    if (table.length < 2) throw new Error("The file has no data rows.");
    return toObjects(table);
  }

  // ---------------------------------------------------------------- cleaning (mirrors utils.clean_raw)
  function toNum(v) {
    if (v == null) return NaN;
    const s = String(v).replace(/[\s,]/g, "");
    if (s === "") return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }
  function quantile(sorted, q) {
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function iqrBounds(values) {
    const s = Float64Array.from(values).sort();
    const q1 = quantile(s, 0.25), q3 = quantile(s, 0.75);
    return [q1 - IQR_K * (q3 - q1), q3 + IQR_K * (q3 - q1)];
  }
  function utcDate(y, m, d) {
    const t = Date.UTC(y, m - 1, d);
    const dt = new Date(t);
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? t : NaN;
  }
  function parseDateText(v) {
    const s = String(v ?? "").trim();
    if (!s) return NaN;
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return utcDate(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) {
      let a = +m[1], b = +m[2], y = +m[3];
      if (y < 100) y += 2000;
      // day-first unless that is impossible (Saudi / European convention)
      return b > 12 ? utcDate(y, a, b) : utcDate(y, b, a);
    }
    const t = Date.parse(s);
    if (Number.isNaN(t)) return NaN;
    const d = new Date(t);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function parseDates(values) {
    const nums = values.map(toNum);
    const valid = nums.filter((n) => !Number.isNaN(n));
    if (valid.length > 0.9 * values.length && valid.every((n) => n >= 1 && n <= 2958465)) {
      return nums.map((n) => (Number.isNaN(n) ? NaN : EXCEL_EPOCH + Math.round(n) * DAY));
    }
    return values.map(parseDateText);
  }

  function cleanRaw(raw) {
    const log = [], fixes = [];
    let rows = raw.map((r, i) => {
      const o = { _i: i };
      for (const d of DIMS) o[d] = String(r[d] ?? "").trim() || "(blank)";
      o.Date = r.Date; o.Cost = r.Cost; o.Sale = r.Sale;
      return o;
    });
    for (const [col, map] of Object.entries(NAME_FIXES)) {
      for (const [bad, good] of Object.entries(map)) {
        const n = rows.filter((r) => r[col] === bad).length;
        if (n) { fixes.push(`${col}: '${bad}' → '${good}' (${n} row${n > 1 ? "s" : ""})`); rows.forEach((r) => { if (r[col] === bad) r[col] = good; }); }
      }
    }
    const step = (name, reason, keep) => {
      const flags = rows.map(keep); // evaluate once: keep() may be stateful (duplicates)
      const removed = rows.filter((_, i) => !flags[i]);
      log.push({ name, reason, n: removed.length, rows: removed.map((r) => raw[r._i]) });
      rows = rows.filter((_, i) => flags[i]);
    };

    rows.forEach((r) => { r.Cost = toNum(r.Cost); r.Sale = toNum(r.Sale); });
    step("Missing Cost/Sale", "Cost or Sale is empty / not a number, or Sale ≤ 0",
      (r) => !Number.isNaN(r.Cost) && !Number.isNaN(r.Sale) && r.Sale > 0);
    if (!rows.length) return { rows, fixes, log };

    const [cLo, cHi] = iqrBounds(rows.map((r) => r.Cost));
    const [sLo, sHi] = iqrBounds(rows.map((r) => r.Sale));
    step("Value outliers", `Cost outside [${fmt(cLo)}, ${fmt(cHi)}] or Sale outside [${fmt(sLo)}, ${fmt(sHi)}]`,
      (r) => r.Cost >= cLo && r.Cost <= cHi && r.Sale >= sLo && r.Sale <= sHi);
    if (!rows.length) return { rows, fixes, log };

    const dates = parseDates(rows.map((r) => r.Date));
    rows.forEach((r, i) => { r.t = dates[i]; });
    const days = rows.filter((r) => !Number.isNaN(r.t)).map((r) => (r.t - EXCEL_EPOCH) / DAY);
    const [dLo, dHi] = days.length ? iqrBounds(days) : [0, 0];
    step("Date outliers",
      `Invalid date or outside ${isoDate(EXCEL_EPOCH + Math.trunc(dLo) * DAY)} … ${isoDate(EXCEL_EPOCH + Math.trunc(dHi) * DAY)} (isolated far from the rest)`,
      (r) => !Number.isNaN(r.t) && (r.t - EXCEL_EPOCH) / DAY >= dLo && (r.t - EXCEL_EPOCH) / DAY <= dHi);

    const seen = new Set();
    step("Duplicates", "Exact duplicate row", (r) => {
      const k = [r.t, ...DIMS.map((d) => r[d]), r.Cost, r.Sale].join("\u0001");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    rows.sort((a, b) => a.t - b.t);
    for (const r of rows) {
      r.Profit = r.Sale - r.Cost;
      r.Margin = Math.round((r.Profit / r.Sale) * 100 * 100) / 100;
      r.ym = isoDate(r.t).slice(0, 7);
      r.weekday = WEEKDAYS[new Date(r.t).getUTCDay()];
    }
    return { rows, fixes, log, changes: cellChanges(raw, rows) };
  }

  // Every cell of a kept row whose cleaned value differs from the raw text, so the
  // report can show exactly what changed (including invisible whitespace).
  const MAX_CHANGES = 20000;
  function cellChanges(raw, rows) {
    const list = [], counts = {};
    let total = 0;
    const add = (r, col, before, after, kinds) => {
      total++;
      for (const k of kinds) counts[k] = (counts[k] || 0) + 1;
      if (list.length < MAX_CHANGES) list.push({ row: r._i + 1, col, before, after, kinds });
    };
    for (const r of [...rows].sort((a, b) => a._i - b._i)) {
      const src = raw[r._i];
      const d0 = String(src.Date ?? ""), d1 = isoDate(r.t);
      if (d0 !== d1) {
        const kinds = [];
        if (d0 !== d0.trim()) kinds.push("Whitespace removed");
        if (d0.trim() !== d1) kinds.push(Number.isNaN(toNum(d0)) ? "Date reformatted" : "Excel serial → date");
        add(r, "Date", d0, d1, kinds);
      }
      for (const f of ["Cost", "Sale"]) {
        const v0 = String(src[f] ?? ""), v1 = String(r[f]);
        if (v0 === v1) continue;
        const kinds = [];
        if (/\s/.test(v0)) kinds.push("Whitespace removed");
        if (v0.includes(",")) kinds.push("Commas removed");
        if (!kinds.length) kinds.push("Number normalised");
        add(r, f, v0, v1, kinds);
      }
      for (const d of DIMS) {
        const v0 = String(src[d] ?? ""), t = v0.trim(), v1 = r[d];
        if (v0 === v1) continue;
        const kinds = [];
        if (!t) kinds.push("Blank filled");
        else {
          if (v0 !== t) kinds.push("Whitespace removed");
          if (t !== v1) kinds.push("Name fixed");
        }
        add(r, d, v0, v1, kinds);
      }
    }
    return { list, counts, total };
  }

  // ---------------------------------------------------------------- state
  const state = {
    source: "sample",
    sampleRaw: null,
    upload: null,      // { name, headers, rows }
    mapping: {},
    currency: "SAR",
    labels: { ...SAMPLE_LABELS },
    dims: [...DIMS],
    data: null,        // { rows, fixes, log, rawCount }
    filters: null,     // { from, to, sel: {dim: Set} }
    tab: "top",
  };

  // ---------------------------------------------------------------- source switching
  function setSource(src) {
    state.source = src;
    $("src-sample").setAttribute("aria-pressed", src === "sample");
    $("src-upload").setAttribute("aria-pressed", src === "upload");
    $("upload-area").hidden = src !== "upload";
    if (src === "sample") loadSample();
    else if (state.upload) buildFromUpload();
    else { $("dash").hidden = true; message(""); }
  }

  async function loadSample() {
    try {
      if (!state.sampleRaw) {
        $("message").innerHTML = '<div class="loading">Loading data…</div>';
        const res = await fetch("data/Kafaat.csv", { cache: "no-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        state.sampleRaw = toObjects(parseCSV(await res.text())).rows;
      }
      state.labels = { ...SAMPLE_LABELS };
      state.dims = [...DIMS];
      state.currency = "SAR";
      process(state.sampleRaw);
    } catch (e) {
      message(`Could not load the Kafaat data (${esc(e.message)}).`);
    }
  }

  function message(html, ok = false) {
    $("message").innerHTML = html ? `<div class="notice${ok ? " ok" : ""}">${html}</div>` : "";
  }

  // ---------------------------------------------------------------- upload + mapping
  function guess(field, headers) {
    const norm = (s) => s.toLowerCase().replace(/[\s_\-]/g, "");
    for (const g of GUESSES[field]) {
      const hit = headers.find((h) => norm(h) === norm(g));
      if (hit) return hit;
    }
    return NONE;
  }

  async function handleFile(file) {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { message("File is larger than 50 MB. Please use a smaller extract."); return; }
    message(`Reading <b>${esc(file.name)}</b>…`, true);
    try {
      const { headers, rows } = await readFile(file);
      state.upload = { name: file.name, headers, rows };
      state.mapping = Object.fromEntries(FIELDS.map((f) => [f, guess(f, headers)]));
      renderMapping();
      buildFromUpload();
    } catch (e) {
      state.upload = null;
      $("mapping").hidden = true;
      $("dash").hidden = true;
      message(`Could not read <b>${esc(file.name)}</b>: ${esc(e.message)}`);
    }
  }

  function renderMapping() {
    const { headers, name } = state.upload;
    const opts = (sel) => `<option value="">— none —</option>` +
      headers.map((h) => `<option value="${esc(h)}"${h === sel ? " selected" : ""}>${esc(h)}</option>`).join("");
    $("map-grid").innerHTML = FIELDS.map((f) => `
      <label class="field">${FIELD_LABELS[f]}${["Date", "Sale", "Cost"].includes(f) ? ' <span class="req">*</span>' : ""}
        <select data-field="${f}">${opts(state.mapping[f])}</select>
      </label>`).join("") + `
      <label class="field">Currency<input id="currency" value="${esc(state.currency)}" maxlength="8"></label>`;
    $("mapping-hint").innerHTML = `<b>${esc(name)}</b> · ${fmt(state.upload.rows.length)} rows · ${headers.length} columns. Columns were detected automatically. Adjust if needed (* required).`;
    $("mapping").hidden = false;
    $("map-grid").querySelectorAll("select").forEach((s) => s.addEventListener("change", () => {
      state.mapping[s.dataset.field] = s.value;
      buildFromUpload();
    }));
    $("currency").addEventListener("input", (e) => { state.currency = e.target.value.trim(); render(); });
  }

  function buildFromUpload() {
    const m = state.mapping;
    const missing = ["Date", "Sale", "Cost"].filter((f) => !m[f]);
    if (missing.length) {
      $("dash").hidden = true;
      message(`Choose the column for: <b>${missing.map((f) => FIELD_LABELS[f]).join(", ")}</b> in the column mapping above.`);
      return;
    }
    const used = FIELDS.map((f) => m[f]).filter(Boolean);
    if (new Set(used).size !== used.length) {
      $("dash").hidden = true;
      message("Each column can only be used once in the mapping.");
      return;
    }
    state.dims = DIMS.filter((d) => m[d]);
    state.labels = Object.fromEntries(DIMS.map((d) => [d, m[d] || d]));
    const raw = state.upload.rows.map((r) => Object.fromEntries(FIELDS.map((f) => [f, m[f] ? r[m[f]] : "All"])));
    process(raw);
  }

  function process(raw) {
    const out = cleanRaw(raw);
    if (!out.rows.length) {
      $("dash").hidden = true;
      message("No valid rows left after cleaning. Check that the date, sale and cost columns are mapped correctly.");
      return;
    }
    state.data = { ...out, rawCount: raw.length };
    const rows = out.rows;
    state.filters = {
      from: isoDate(rows[0].t),
      to: isoDate(rows[rows.length - 1].t),
      sel: Object.fromEntries(state.dims.map((d) => [d, new Set(rows.map((r) => r[d]))])),
    };
    state.tab = "top";
    message("");
    renderFilters();
    renderReport();
    $("dash").hidden = false; // visible first so charts can measure their width
    render();
  }

  // ---------------------------------------------------------------- filters
  function renderFilters() {
    const rows = state.data.rows;
    const min = isoDate(rows[0].t), max = isoDate(rows[rows.length - 1].t);
    const f = state.filters;
    let html = `
      <label class="field">From<input type="date" id="f-from" value="${f.from}" min="${min}" max="${max}"></label>
      <label class="field">To<input type="date" id="f-to" value="${f.to}" min="${min}" max="${max}"></label>`;
    for (const d of state.dims) {
      const opts = [...new Set(rows.map((r) => r[d]))].sort((a, b) => a.localeCompare(b));
      html += `<details class="dd" data-dim="${d}"><summary></summary><div class="menu">
        <label class="all"><input type="checkbox" data-all="${d}"> All</label>
        ${opts.map((o) => `<label><input type="checkbox" data-dim="${d}" value="${esc(o)}"${f.sel[d].has(o) ? " checked" : ""}> ${esc(o)}</label>`).join("")}
      </div></details>`;
    }
    html += `<button type="button" class="link-btn" id="f-reset">Reset filters</button>`;
    const box = $("filters");
    box.innerHTML = html;
    updateFilterLabels();

    $("f-from").addEventListener("change", (e) => { f.from = e.target.value || min; render(); });
    $("f-to").addEventListener("change", (e) => { f.to = e.target.value || max; render(); });
    $("f-reset").addEventListener("click", () => {
      f.from = min; f.to = max;
      for (const d of state.dims) f.sel[d] = new Set(rows.map((r) => r[d]));
      renderFilters(); render();
    });
    box.querySelectorAll("input[data-dim]").forEach((cb) => cb.addEventListener("change", () => {
      const s = f.sel[cb.dataset.dim];
      cb.checked ? s.add(cb.value) : s.delete(cb.value);
      updateFilterLabels(); render();
    }));
    box.querySelectorAll("input[data-all]").forEach((cb) => cb.addEventListener("change", () => {
      const d = cb.dataset.all;
      box.querySelectorAll(`input[data-dim="${d}"]`).forEach((x) => { x.checked = cb.checked; });
      f.sel[d] = cb.checked ? new Set(rows.map((r) => r[d])) : new Set();
      updateFilterLabels(); render();
    }));
    box.querySelectorAll("details.dd").forEach((dd) => dd.addEventListener("toggle", () => {
      if (dd.open) box.querySelectorAll("details.dd[open]").forEach((o) => { if (o !== dd) o.open = false; });
    }));
  }

  function updateFilterLabels() {
    const rows = state.data.rows;
    $("filters").querySelectorAll("details.dd").forEach((dd) => {
      const d = dd.dataset.dim;
      const total = new Set(rows.map((r) => r[d])).size;
      const n = state.filters.sel[d].size;
      dd.querySelector("summary").textContent = `${state.labels[d]} (${n === total ? "all" : n + "/" + total})`;
      dd.querySelector(`input[data-all="${d}"]`).checked = n === total;
    });
  }

  document.addEventListener("click", (e) => {
    document.querySelectorAll("details.dd[open]").forEach((dd) => { if (!dd.contains(e.target)) dd.open = false; });
  });

  function filtered() {
    const f = state.filters;
    const from = Date.parse(f.from + "T00:00:00Z"), to = Date.parse(f.to + "T00:00:00Z") + DAY;
    return state.data.rows.filter((r) => r.t >= from && r.t < to && state.dims.every((d) => f.sel[d].has(r[d])));
  }

  // ---------------------------------------------------------------- aggregation
  function groupBy(rows, key) {
    const m = new Map();
    for (const r of rows) {
      const k = typeof key === "function" ? key(r) : r[key];
      let g = m.get(k);
      if (!g) m.set(k, (g = { key: k, deals: 0, sales: 0, cost: 0, profit: 0, first: r.t, last: r.t }));
      g.deals++; g.sales += r.Sale; g.cost += r.Cost; g.profit += r.Profit;
      if (r.t < g.first) g.first = r.t;
      if (r.t > g.last) g.last = r.t;
    }
    const total = sum([...m.values()], (g) => g.sales);
    for (const g of m.values()) { g.margin = (g.profit / g.sales) * 100; g.share = (g.sales / total) * 100; }
    return [...m.values()];
  }

  // ---------------------------------------------------------------- render
  function renderReport() {
    const { log, fixes, rawCount, rows } = state.data;
    const removed = rawCount - rows.length;
    const ch = state.data.changes;
    $("report-title").textContent = `🧹 Cleaning report: ${fmt(rawCount)} rows in, ${fmt(rows.length)} kept, ${fmt(removed)} removed, ${fmt(ch.total)} cells changed`;
    let html = `<table class="data"><thead><tr><th>Step</th><th class="n">Rows removed</th><th>Reason</th></tr></thead><tbody>` +
      log.map((s) => `<tr><td>${s.name}</td><td class="n">${fmt(s.n)}</td><td>${esc(s.reason)}</td></tr>`).join("") + "</tbody></table>";
    if (fixes.length) html += `<p style="margin-top:12px">Name fixes (rows kept): ${fixes.map(esc).join(" · ")}</p>`;
    for (const s of log) {
      if (!s.n) continue;
      html += `<p style="margin:14px 0 6px"><b>${s.name}</b>: removed rows${s.n > 50 ? " (first 50)" : ""}</p>
        <table class="data"><thead><tr>${FIELDS.map((f) => `<th>${esc(DIMS.includes(f) ? state.labels[f] : f)}</th>`).join("")}</tr></thead><tbody>` +
        s.rows.slice(0, 50).map((r) => `<tr>${FIELDS.map((f) => `<td>${esc(r[f]) || "<i>(blank)</i>"}</td>`).join("")}</tr>`).join("") + "</tbody></table>";
    }
    html += `<h4 class="ch-title">Cell changes in kept rows (${fmt(ch.total)})</h4>`;
    if (!ch.total) html += `<p class="hint">No cell values were changed.</p>`;
    else {
      const cols = [...new Set(ch.list.map((c) => c.col))];
      html += `<p class="hint">Every value the cleaning changed, exactly as it was in the file.
          Invisible characters are marked: <span class="ws">·</span> space · <span class="ws">→</span> tab ·
          <span class="ws">°</span> non-breaking space · <span class="ws">↵</span> line break · <span class="ws">∅</span> empty.</p>
        <div class="ch-chips">${Object.entries(ch.counts).map(([k, n]) => `<span>${esc(k)} <b>${fmt(n)}</b></span>`).join("")}</div>
        <div class="ch-bar">
          <label class="field">Change<select id="ch-kind"><option value="">All changes</option>${Object.keys(ch.counts).map((k) => `<option>${esc(k)}</option>`).join("")}</select></label>
          <label class="field">Column<select id="ch-col"><option value="">All columns</option>${cols.map((c) => `<option value="${c}">${esc(colLabel(c))}</option>`).join("")}</select></label>
          <button type="button" class="btn" id="ch-download">Download change log (CSV)</button>
        </div>
        <div id="ch-table"></div>`;
    }
    $("report-body").innerHTML = html;
    if (!ch.total) return;
    const draw = () => {
      const kind = $("ch-kind").value, col = $("ch-col").value;
      const list = ch.list.filter((c) => (!kind || c.kinds.includes(kind)) && (!col || c.col === col));
      const LIMIT = 300;
      $("ch-table").innerHTML = `<p class="hint">${fmt(list.length)} change${list.length === 1 ? "" : "s"}${list.length > LIMIT ? `, showing the first ${LIMIT} (download the log for all)` : ""}${ch.list.length < ch.total ? ` · log capped at ${fmt(ch.list.length)} of ${fmt(ch.total)}` : ""}</p>
        <table class="data"><thead><tr><th class="n">Row</th><th>Column</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>` +
        list.slice(0, LIMIT).map((c) => `<tr><td class="n">${fmt(c.row)}</td><td>${esc(colLabel(c.col))}</td><td class="ch-before">${showWs(c.before)}</td><td class="ch-after">${showWs(c.after)}</td><td>${c.kinds.map(esc).join(", ")}</td></tr>`).join("") +
        "</tbody></table>";
    };
    $("ch-kind").addEventListener("change", draw);
    $("ch-col").addEventListener("change", draw);
    $("ch-download").addEventListener("click", downloadChanges);
    draw();
  }

  const colLabel = (c) => (DIMS.includes(c) ? state.labels[c] : c);
  // Escape, then make invisible characters visible.
  function showWs(v) {
    if (v === "") return '<span class="ws">∅</span>';
    return esc(v).replace(/ /g, '<span class="ws">·</span>').replace(/\t/g, '<span class="ws">→</span>')
      .replace(/ /g, '<span class="ws">°</span>').replace(/\r?\n|\r/g, '<span class="ws">↵</span>');
  }

  function downloadChanges() {
    const cell = (v) => { const s = String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };
    const vis = (v) => String(v).replace(/ /g, "·").replace(/\t/g, "→").replace(/ /g, "°").replace(/\r?\n|\r/g, "↵");
    const lines = [["Row", "Column", "Before", "Before (whitespace shown)", "After", "Change"].join(",")].concat(state.data.changes.list.map((c) =>
      [c.row, colLabel(c.col), c.before, vis(c.before), c.after, c.kinds.join("; ")].map(cell).join(",")));
    saveCSV(lines, "_changes.csv", "kafaat_changes.csv");
  }

  function saveCSV(lines, suffix, sampleName) {
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = state.source === "sample" ? sampleName : state.upload.name.replace(/\.[^.]+$/, "") + suffix;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function render() {
    const rows = filtered();
    const cur = state.currency ? " " + esc(state.currency) : "";
    if (!rows.length) {
      $("kpis").innerHTML = `<div class="notice" style="grid-column:1/-1">No deals match the current filters.</div>`;
      ["c-bar1", "c-donut", "c-line", "c-heat", "c-bar2", "c-hist", "c-table"].forEach((id) => { $(id).innerHTML = ""; });
      return;
    }
    renderKPIs(rows, cur);
    const dims = state.dims;
    const first = dims[0], second = dims[1], last = dims.length > 1 ? dims[dims.length - 1] : null;

    // row 1: bar (first dim) + donut (last dim)
    showCards("c-bar1", "c-donut", !!first, !!last);
    if (first) {
      $("t-bar1").textContent = `Sales by ${state.labels[first].toLowerCase()}`;
      renderBars($("c-bar1"), groupBy(rows, first), "sales", (g) => `${fmtK(g.sales)}<span class="extra"> · profit ${fmtK(g.profit)} (${pct(g.margin)})</span>`, cur, first);
    }
    if (last) { $("t-donut").textContent = `Sales share by ${state.labels[last].toLowerCase()}`; renderDonut(rows, last, cur); }

    renderLine(rows, cur);

    // row 3: heatmap (first × last) + profit bars (second dim)
    const heatOk = first && last && first !== last;
    showCards("c-heat", "c-bar2", heatOk, !!second);
    if (heatOk) { $("t-heat").textContent = `Sales by ${state.labels[first].toLowerCase()} × ${state.labels[last].toLowerCase()}`; renderHeat(rows, first, last, cur); }
    if (second) {
      $("t-bar2").textContent = `Profit by ${state.labels[second].toLowerCase()}`;
      renderBars($("c-bar2"), groupBy(rows, second), "profit", (g) => `${fmtK(g.profit)} (${pct(g.margin)})`, cur, second);
    }

    renderHist(rows, cur);
    renderTabs(rows, cur);
  }

  function showCards(idA, idB, a, b) {
    const ca = $(idA).closest(".chart"), cb = $(idB).closest(".chart");
    ca.hidden = !a; cb.hidden = !b;
    ca.parentElement.hidden = !a && !b;
    ca.parentElement.style.gridTemplateColumns = a && b ? "" : "1fr";
  }

  function renderKPIs(rows, cur) {
    const sales = sum(rows, (r) => r.Sale), profit = sum(rows, (r) => r.Profit);
    const low = rows.filter((r) => r.Margin < LOW_MARGIN);
    const lowSales = sum(low, (r) => r.Sale), lowProfit = sum(low, (r) => r.Profit);
    const card = (l, v, s) => `<div class="kpi"><span class="l">${l}</span><span class="v num">${v}</span><span class="s">${s}</span></div>`;
    $("kpis").innerHTML =
      card("Total sales", fmtK(sales), `${fmt(sales)}${cur}`) +
      card("Total profit", fmtK(profit), `${fmt(profit)}${cur}`) +
      card("Profit margin", pct((profit / sales) * 100), "profit ÷ sales") +
      card("Deals", fmt(rows.length), `avg ${fmt(sales / rows.length)}${cur} per deal`) +
      card(`Deals below ${LOW_MARGIN}% margin`, pct((low.length / rows.length) * 100),
        `${pct((lowSales / sales) * 100)} of sales · ${pct((lowProfit / profit) * 100)} of profit`);
  }

  function renderBars(el, groups, measure, label, cur, dim) {
    groups.sort((a, b) => b[measure] - a[measure]);
    const shown = groups.slice(0, 15);
    const max = Math.max(...shown.map((g) => g[measure]), 0) || 1;
    el.innerHTML = shown.map((g) => {
      const w = Math.max(0, (g[measure] / max) * 62);
      return `<div class="bar-row"><span class="name" title="${esc(g.key)}">${esc(g.key)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${w}%"></div><span class="bar-val num" style="left:${w}%">${label(g)}</span></div></div>`;
    }).join("") + (groups.length > 15 ? `<p class="sub" style="margin:6px 0 0">Top 15 of ${groups.length}</p>` : "");
    bindTips(el, ".bar-row", (i) => groupTip(shown[i], cur, dim));
  }

  const groupTip = (g, cur, dim) => `<b>${esc(state.labels[dim])}: ${esc(g.key)}</b><br>Sales: ${fmt(g.sales)}${cur}<br>Profit: ${fmt(g.profit)}${cur}<br>Margin: ${pct(g.margin)}<br>Deals: ${fmt(g.deals)} · Share: ${pct(g.share)}`;

  function renderDonut(rows, dim, cur) {
    let groups = groupBy(rows, dim).sort((a, b) => b.sales - a.sales);
    if (groups.length > CAT.length + 1) {
      const rest = groups.slice(CAT.length);
      const other = { key: `Other (${rest.length})`, sales: sum(rest, (g) => g.sales), profit: sum(rest, (g) => g.profit), deals: sum(rest, (g) => g.deals), other: true };
      other.margin = (other.profit / other.sales) * 100;
      other.share = sum(rest, (g) => g.share);
      groups = [...groups.slice(0, CAT.length), other];
    }
    const total = sum(groups, (g) => g.sales);
    const R = 100, r = 60, cx = 110, cy = 110;
    let a0 = -Math.PI / 2, paths = "";
    groups.forEach((g, i) => {
      const frac = g.sales / total;
      const a1 = a0 + frac * 2 * Math.PI;
      const color = g.other ? OTHER : CAT[i];
      if (frac >= 0.9999) {
        paths += `<circle class="seg" cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${color}" stroke-width="${R - r}"/>`;
      } else {
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const p = (rad, ang) => `${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`;
        paths += `<path class="seg" d="M${p(R, a0)} A${R},${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${large} 0 ${p(r, a0)}Z" fill="${color}" stroke="#fff" stroke-width="2"/>`;
      }
      a0 = a1;
    });
    const center = `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="20" font-weight="600" fill="#2A1748">${fmtK(total)}</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="11" fill="#5E4F7A">total sales</text>`;
    const legend = `<ul class="legend">${groups.map((g, i) => `<li><span class="sw" style="background:${g.other ? OTHER : CAT[i]}"></span><span>${esc(g.key)}</span><span class="pct num">${fmtK(g.sales)} · ${pct((g.sales / total) * 100)}</span></li>`).join("")}</ul>`;
    const el = $("c-donut");
    el.innerHTML = svgEl(220, 220, paths + center) + legend;
    bindTips(el, ".seg", (i) => groupTip(groups[i], cur, dim));
    bindTips(el, ".legend li", (i) => groupTip(groups[i], cur, dim));
  }

  // draw SVG charts at their real on-screen width so text stays readable on phones
  const chartWidth = (id) => Math.max(300, Math.round($(id).clientWidth || 1000));

  function niceStep(max, ticks = 4) {
    const raw = max / ticks, mag = 10 ** Math.floor(Math.log10(raw || 1));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }

  function renderLine(rows, cur) {
    const months = groupBy(rows, (r) => r.ym).sort((a, b) => a.key.localeCompare(b.key));
    months.forEach((m) => {
      const y = +m.key.slice(0, 4), mo = +m.key.slice(5, 7);
      const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      m.partial = (m.last - m.first) / DAY + 1 < dim - 3;
      m.idx = y * 12 + mo;
    });
    const full = months.filter((m) => !m.partial);
    full.forEach((m, i) => { m.avg = i >= 2 ? (full[i].sales + full[i - 1].sales + full[i - 2].sales) / 3 : null; });

    const W = chartWidth("c-line"), H = W < 600 ? 240 : 300, L = 52, Rr = 14, T = 14, B = 30;
    const i0 = months[0].idx, i1 = months[months.length - 1].idx;
    const x = (idx) => L + (i1 === i0 ? (W - L - Rr) / 2 : ((idx - i0) / (i1 - i0)) * (W - L - Rr));
    const step = niceStep(Math.max(...months.map((m) => m.sales)) * 1.1);
    const yMax = Math.ceil((Math.max(...months.map((m) => m.sales)) * 1.1) / step) * step;
    const y = (v) => T + (1 - v / yMax) * (H - T - B);

    let g = `<g class="ax">`;
    for (let v = 0; v <= yMax + 1e-9; v += step) g += `<line x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${fmtK(v)}</text>`;
    const every = Math.max(1, Math.ceil(months.length / Math.max(3, Math.floor(W / 110))));
    months.forEach((m, i) => { if (i % every === 0) g += `<text x="${x(m.idx)}" y="${H - 8}" text-anchor="middle">${ymLabel(m.key)}</text>`; });
    g += "</g>";

    const path = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
    const line = full.length > 1 ? `<path class="mark-line" d="${path(full.map((m) => [x(m.idx), y(m.sales)]))}"/>` : "";
    const avgPts = full.filter((m) => m.avg != null);
    const avg = avgPts.length > 1 ? `<path class="mark-avg" d="${path(avgPts.map((m) => [x(m.idx), y(m.avg)]))}"/>` : "";
    const dots = months.map((m) => `<circle class="dot${m.partial ? " partial" : ""}" cx="${x(m.idx)}" cy="${y(m.sales)}" r="${m.partial ? 5 : 4.5}"/>`).join("");
    const halfW = months.length > 1 ? (x(months[1].idx) - x(months[0].idx)) / 2 : 40;
    const hits = months.map((m) => `<rect class="hit" x="${x(m.idx) - halfW}" y="${T}" width="${halfW * 2}" height="${H - T - B}"/>`).join("");
    const el = $("c-line");
    el.innerHTML = svgEl(W, H, g + avg + line + `<line class="xhair" id="xhair" y1="${T}" y2="${H - B}" visibility="hidden"/>` + dots + hits);
    const xh = el.querySelector("#xhair");
    el.querySelectorAll(".hit").forEach((h, i) => {
      const m = months[i];
      tips.set(h, `<b>${ymLabel(m.key)}</b>${m.partial ? " (partial month)" : ""}<br>Sales: ${fmt(m.sales)}${cur}<br>Profit: ${fmt(m.profit)}${cur} (${pct(m.margin)})<br>Deals: ${fmt(m.deals)}${m.avg != null ? `<br>3-month avg: ${fmt(m.avg)}${cur}` : ""}`);
      h.addEventListener("mouseenter", () => { xh.setAttribute("x1", x(m.idx)); xh.setAttribute("x2", x(m.idx)); xh.setAttribute("visibility", "visible"); });
      h.addEventListener("mouseleave", () => xh.setAttribute("visibility", "hidden"));
    });
  }

  function renderHeat(rows, rDim, cDim, cur) {
    const topR = groupBy(rows, rDim).sort((a, b) => b.sales - a.sales).slice(0, 12).map((g) => g.key);
    const topC = groupBy(rows, cDim).sort((a, b) => b.sales - a.sales).slice(0, 8).map((g) => g.key);
    const cells = new Map();
    for (const r of rows) {
      const k = r[rDim] + "\u0001" + r[cDim];
      const c = cells.get(k) || { sales: 0, profit: 0, deals: 0 };
      c.sales += r.Sale; c.profit += r.Profit; c.deals++;
      cells.set(k, c);
    }
    const vals = topR.flatMap((a) => topC.map((b) => (cells.get(a + "\u0001" + b) || { sales: 0 }).sales));
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const color = (v) => RAMP[hi === lo ? 4 : Math.round(((v - lo) / (hi - lo)) * (RAMP.length - 1))];
    const info = [];
    let html = `<table class="heat"><thead><tr><th></th>${topC.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead><tbody>`;
    for (const a of topR) {
      html += `<tr><th scope="row">${esc(a)}</th>`;
      for (const b of topC) {
        const c = cells.get(a + "\u0001" + b) || { sales: 0, profit: 0, deals: 0 };
        const bg = color(c.sales), dark = RAMP.indexOf(bg) >= 5;
        info.push({ a, b, c });
        html += `<td class="num" style="background:${bg};color:${dark ? "#fff" : "#2A1748"}">${nf0.format(c.sales / 1000)}</td>`;
      }
      html += "</tr>";
    }
    const el = $("c-heat");
    el.innerHTML = html + "</tbody></table>";
    bindTips(el, "td", (i) => {
      const { a, b, c } = info[i];
      return `<b>${esc(a)} × ${esc(b)}</b><br>Sales: ${fmt(c.sales)}${cur}<br>Profit: ${fmt(c.profit)}${cur} (${pct((c.profit / c.sales) * 100)})<br>Deals: ${fmt(c.deals)}`;
    });
  }

  function renderHist(rows, cur) {
    const clamp = (v) => Math.max(-100, Math.min(100, v));
    const bins = new Map();
    for (const r of rows) {
      const b = Math.floor(clamp(r.Margin));
      const g = bins.get(b) || { deals: 0, profit: 0, sales: 0 };
      g.deals++; g.profit += r.Profit; g.sales += r.Sale;
      bins.set(b, g);
    }
    const keys = [...bins.keys()];
    const b0 = Math.min(...keys), b1 = Math.max(...keys);
    const W = chartWidth("c-hist"), H = W < 600 ? 220 : 260, L = 52, Rr = 14, T = 14, B = 30;
    const n = b1 - b0 + 1, bw = (W - L - Rr) / n;
    const maxP = Math.max(...[...bins.values()].map((g) => g.profit), 1);
    const step = niceStep(maxP * 1.1);
    const yMax = Math.ceil((maxP * 1.1) / step) * step;
    const minP = Math.min(0, ...[...bins.values()].map((g) => g.profit));
    const yMin = minP < 0 ? -Math.ceil(-minP / step) * step : 0;
    const y = (v) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);
    const totalProfit = sum(rows, (r) => r.Profit);

    let g = `<g class="ax">`;
    for (let v = yMin; v <= yMax + 1e-9; v += step) g += `<line x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${fmtK(v)}</text>`;
    const fit = Math.max(3, Math.floor(W / 48));
    const labelEvery = [1, 2, 5, 10, 20, 25, 50].find((k) => n / k <= fit) || 50;
    for (let b = b0; b <= b1; b++) if (b % labelEvery === 0) g += `<text x="${L + (b - b0 + 0.5) * bw}" y="${H - 8}" text-anchor="middle">${b}%</text>`;
    g += "</g>";
    const list = [];
    let bars = "";
    for (let b = b0; b <= b1; b++) {
      const v = bins.get(b);
      if (!v) continue;
      list.push([b, v]);
      const top = y(Math.max(v.profit, 0)), bottom = y(Math.min(v.profit, 0));
      bars += `<rect x="${(L + (b - b0) * bw + Math.min(1, bw * 0.1)).toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1, bw - Math.min(2, bw * 0.2)).toFixed(1)}" height="${Math.max(1, bottom - top).toFixed(1)}" rx="${bw > 6 ? 2 : 0}" fill="${b < LOW_MARGIN ? "#CDB6F5" : "#6D3FD0"}"/>`;
    }
    const el = $("c-hist");
    el.innerHTML = svgEl(W, H, g + `<g class="hbars">${bars}</g>`);
    bindTips(el, ".hbars rect", (i) => {
      const [b, v] = list[i];
      return `<b>Margin ${b}% – ${b + 1}%</b><br>Deals: ${fmt(v.deals)} (${pct((v.deals / rows.length) * 100)})<br>Sales: ${fmt(v.sales)}${cur}<br>Profit: ${fmt(v.profit)}${cur} (${pct((v.profit / totalProfit) * 100)} of profit)`;
    });
  }

  function renderTabs(rows, cur) {
    const tabs = [["top", "Top 10 deals"], ...state.dims.map((d) => [d, `By ${state.labels[d].toLowerCase()}`])];
    if (!tabs.some(([k]) => k === state.tab)) state.tab = "top";
    $("tabs").innerHTML = tabs.map(([k, l]) => `<button type="button" data-tab="${esc(k)}" aria-pressed="${k === state.tab}">${esc(l)}</button>`).join("");
    $("tabs").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { state.tab = b.dataset.tab; renderTabs(filtered(), cur); }));

    let html;
    if (state.tab === "top") {
      const top = [...rows].sort((a, b) => b.Profit - a.Profit).slice(0, 10);
      html = `<table class="data"><thead><tr><th>Date</th>${state.dims.map((d) => `<th>${esc(state.labels[d])}</th>`).join("")}<th class="n">Cost</th><th class="n">Sale</th><th class="n">Profit</th><th class="n">Margin</th></tr></thead><tbody>` +
        top.map((r) => `<tr><td class="num">${isoDate(r.t)}</td>${state.dims.map((d) => `<td>${esc(r[d])}</td>`).join("")}<td class="n num">${nf2.format(r.Cost)}</td><td class="n num">${nf2.format(r.Sale)}</td><td class="n num">${nf2.format(r.Profit)}</td><td class="n num">${pct(r.Margin)}</td></tr>`).join("") + "</tbody></table>";
    } else {
      const d = state.tab;
      const groups = groupBy(rows, d).sort((a, b) => b.sales - a.sales);
      html = `<table class="data"><thead><tr><th>${esc(state.labels[d])}</th><th class="n">Deals</th><th class="n">Sales${cur}</th><th class="n">Profit${cur}</th><th class="n">Margin</th><th class="n">Share of sales</th></tr></thead><tbody>` +
        groups.map((g) => `<tr><td>${esc(g.key)}</td><td class="n num">${fmt(g.deals)}</td><td class="n num">${fmt(g.sales)}</td><td class="n num">${fmt(g.profit)}</td><td class="n num">${pct(g.margin)}</td><td class="n num">${pct(g.share)}</td></tr>`).join("") + "</tbody></table>";
    }
    $("c-table").innerHTML = html;
  }

  function downloadCSV() {
    const rows = filtered();
    const cell = (v) => { const s = String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };
    const head = ["Date", ...state.dims.map((d) => state.labels[d]), "Cost", "Sale", "Profit", "Margin_%"];
    const lines = [head.map(cell).join(",")].concat(rows.map((r) =>
      [isoDate(r.t), ...state.dims.map((d) => r[d]), r.Cost, r.Sale, +r.Profit.toFixed(4), r.Margin].map(cell).join(",")));
    saveCSV(lines, "_cleaned.csv", "kafaat_cleaned.csv");
  }

  // ---------------------------------------------------------------- wiring
  $("src-sample").addEventListener("click", () => setSource("sample"));
  $("src-upload").addEventListener("click", () => setSource("upload"));
  $("file-input").addEventListener("change", (e) => handleFile(e.target.files[0]));
  const dz = $("dropzone");
  ["dragenter", "dragover"].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));
  $("download").addEventListener("click", downloadCSV);
  let resizeTimer, lastW = innerWidth;
  addEventListener("resize", () => {
    if (innerWidth === lastW) return;
    lastW = innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.data && !$("dash").hidden) render(); }, 150);
  });

  // expose the cleaning core for automated checks (node / devtools)
  window.KafaatClean = { parseCSV, toObjects, cleanRaw };
  loadSample();
})();
