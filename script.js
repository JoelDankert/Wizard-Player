const $cards = document.getElementById("cards");
const $players = document.getElementById("players");

const $banner = document.getElementById("eventBanner");
const $bannerText = document.getElementById("bannerText");

const $modal = document.getElementById("modal");
const $modalContent = document.getElementById("modalContent");

const $wait = document.getElementById("wait");
const $waitSummary = document.getElementById("waitSummary");
const $waitBody = document.getElementById("waitBody");

let lastSeq = 0;
let initialized = false;

// Queue für Events (alle nacheinander)
const eventQueue = [];
let bannerOpen = false;
let hideTimer = null;

function el(tag, cls, text){
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function fractionClass(goal, reached){
  if (reached < goal) return "under";
  if (reached === goal) return "ok";
  return "over";
}

function render(state){
  // Karten-Header
  $cards.textContent = state.cards ?? "–";

  // Spieler nach Goal absteigend (links->rechts)
  const players = [...(state.players || [])].map((p, i) => ({
    pref: p.pref,
    name: (p.name || "").trim() || p.pref.toUpperCase(),
    goal: (state.goals || [])[i] ?? 0,
    reached: (state.reached || [])[i] ?? 0,
  })).sort((a, b) => b.goal - a.goal);

  // Preview-Score (inkl. +o-Bonus, auch 0/0 => +20) kommt direkt vom Backend im Feld preview_scores
  const preview = state.preview_scores || [];

  // Render
  $players.textContent = "";
  for (let idx = 0; idx < players.length; idx++){
    const p = players[idx];
    // Da wir sortiert haben, müssen wir den richtigen preview-Wert über Index im Original-Array holen:
    const originalIndex = (state.players || []).findIndex(sp => sp.pref === p.pref && (sp.name||"") === (p.name ? " " + p.name : sp.name));
    const rp = preview[originalIndex >= 0 ? originalIndex : idx] ?? 0;

    const card = el("article", "player");
    card.append(el("div", "name", p.name));
    card.append(el("div", `bigfraction ${fractionClass(p.goal, p.reached)}`, `${p.reached}/${p.goal}`));
    card.append(el("div", "roundpoints mono", `${rp >= 0 ? "+" : ""}${rp}`));
    $players.append(card);
  }

  // Wartescreen
  if (state.wait){
    $wait.classList.add("show");
    // Letzte Runde (Placement + Rundenpunkte + Total)
    const lr = state.last_round;
    if (lr && Array.isArray(lr.items) && lr.items.length){
      $waitSummary.classList.remove("hidden");
      $waitBody.textContent = "";
      for (const row of lr.items){
        const tr = el("tr");
        const pos = el("td"); pos.append(el("span", "badge-pos", `${row.place}`)); tr.append(pos);
        tr.append(el("td", null, row.name));
        tr.append(el("td", "mono", `${row.round_score >= 0 ? "+" : ""}${row.round_score}`));
        tr.append(el("td", "mono", `${row.total}`));
        $waitBody.append(tr);
      }
    } else {
      $waitSummary.classList.add("hidden");
    }
  } else {
    $wait.classList.remove("show");
  }

  // Totals-Modal (nur Totals, kein Rundenscore)
  if (state.modal && state.modal.kind === "totals"){
    renderTotalsModal(state.modal);
    $modal.classList.add("show");
  } else {
    $modal.classList.remove("show");
  }
}

function renderTotalsModal(modal){
  $modalContent.textContent = "";
  const title = el("h2", null, "Totals");
  const table = el("table", "table");
  const thead = el("thead");
  const thr = el("tr");
  thr.append(el("th", null, "#"));
  thr.append(el("th", null, "Spieler"));
  thr.append(el("th", null, "Totals"));
  thead.append(thr);
  table.append(thead);

  const tbody = el("tbody");
  for (const row of (modal.items || [])){
    const tr = el("tr");
    const pos = el("td"); pos.append(el("span", "badge-pos", `${row.place}`)); tr.append(pos);
    tr.append(el("td", null, row.name));
    tr.append(el("td", "mono", `${row.score}`));
    tbody.append(tr);
  }
  table.append(tbody);
  $modalContent.append(title, table);
}

/* —— Vollscreen-Banner mit Queue —— */
function showNextBanner(){
  if (bannerOpen || eventQueue.length === 0) return;
  const e = eventQueue.shift();
  bannerOpen = true;

  $banner.className = "banner show " + (e.color || "gray");
  $bannerText.textContent = e.text;

  if (hideTimer){ clearTimeout(hideTimer); }
  hideTimer = setTimeout(()=>{
    $banner.className = "banner hidden";
    bannerOpen = false;
    setTimeout(showNextBanner, 50);
  }, 3000);
}

async function poll(){
  try{
    const res = await fetch("/state", { cache: "no-store" });
    const state = await res.json();
    render(state);

    // Events in Queue
    const events = (state.events || []).filter(e => (e.seq || 0) > lastSeq)
                                       .sort((a,b) => (a.seq||0) - (b.seq||0));
    if (!initialized){
      lastSeq = (state.events || []).reduce((m, e) => Math.max(m, e.seq || 0), 0);
      initialized = true;
    } else {
      for (const e of events){
        eventQueue.push(e);
        lastSeq = Math.max(lastSeq, e.seq || 0);
      }
      showNextBanner();
    }
  } catch(_) {
    /* weiterpolling */
  } finally{
    setTimeout(poll, 800);
  }
}

poll();
function toggleFullscreen(){
  if (!document.fullscreenElement){
    document.documentElement.requestFullscreen().catch(()=>{});
  } else {
    document.exitFullscreen().catch(()=>{});
  }
}

// Ein Tap/Klick irgendwo im View toggelt Fullscreen
document.addEventListener("click", toggleFullscreen, { passive: true });
