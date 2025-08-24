const $cards = document.getElementById("cards");

const $players = document.getElementById("players");

const $banner = document.getElementById("eventBanner");
const $bannerText = document.getElementById("bannerText");

const $modal = document.getElementById("modal");
const $modalContent = document.getElementById("modalContent");

const $wait = document.getElementById("wait");
const $waitSummary = document.getElementById("waitSummary");
const $waitBody = document.getElementById("waitBody");
const $scoresBody = document.getElementById("scoresBody");
const sounds = {
    goal: new Audio("sounds/goal.mp3"),         // Spieler zielt X Stiche an
    stack: new Audio("sounds/stack.mp3"),       // Spieler nimmt Stapel
    roundEnd: new Audio("sounds/roundend.mp3"), // Runde abgeschlossen
};

let lastSeq = 0;
let initialized = false;

// Queue für Events (alle nacheinander)
const eventQueue = [];
let bannerOpen = false;
let hideTimer = null;

/* ————— Helpers ————— */

function playSound(name, volume = 1.0) {
    const s = sounds[name];
    if (s) {
        const clone = s.cloneNode();
        clone.volume = volume;
        clone.play().catch(()=>{});
    }
}
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
function normalizeName(s){
    return String(s ?? "").trim().replace(/\s+/g, " ");
}
function nameKey(s){
    return normalizeName(s).toLowerCase();
}

/* ————— Central standings renderer ————— */
function renderStandingsTable(targetEl, rows, {
    showRound = false,
    title = null,
} = {}) {
    const isTbody = targetEl && targetEl.tagName && targetEl.tagName.toUpperCase() === "TBODY";

    // Gather round scores if the "Runde" column is shown
    let roundScores = [];
    if (showRound && Array.isArray(rows) && rows.length) {
        roundScores = rows.map(r => Number(r.round_score)).filter(v => Number.isFinite(v));
    }

    // Compute min/max and bottom-30% threshold for '?'
    let maxRoundScore = null, minRoundScore = null, bottom30Threshold = null;
    if (roundScores.length) {
        const sorted = [...roundScores].sort((a, b) => a - b);
        minRoundScore = sorted[0];
        maxRoundScore = sorted[sorted.length - 1];
        const idx = Math.max(0, Math.floor(sorted.length * 0.3) - 1);
        bottom30Threshold = sorted[Math.min(idx, sorted.length - 1)];
    }

    function buildRow(row, totalRows) {
        const tr = el("tr");

        // Place
        const pos = el("td");
        pos.append(el("span", "badge-pos", String(row.place ?? "")));
        tr.append(pos);

        // Name + indicators
        const nameText = normalizeName(row.name ?? "");
        const nameCell = el("td", null, nameText);

        const indicators = [];
        if (showRound) {
            const v = Number(row.round_score);
            if (Number.isFinite(v)) {
                if (v === maxRoundScore) indicators.push("⇑");   // highest round
                if (v === minRoundScore) indicators.push("⇓");   // lowest round
                if (v === 20)            indicators.push("⤻");   // exactly 20

                // bottom 30% round but top 50% placement
                if (bottom30Threshold != null && v <= bottom30Threshold) {
                    const total = totalRows || rows.length || 1;
                    const top50Limit = Math.ceil(total / 2);
                    if (Number(row.place) && Number(row.place) <= top50Limit) {
                        indicators.push("?");
                    }
                }
            }

            // ⤵ underestimated: goal < reached
            const g = Number(row.goal);
            const r = Number(row.reached);
            if (Number.isFinite(g) && Number.isFinite(r) && g < r) {
                indicators.push("⤵");
            }
        }

        if (indicators.length) {
            nameCell.textContent += " " + indicators.join(" ");
        }
        tr.append(nameCell);

        // Round score column with color
        if (showRound) {
            const v = Number(row.round_score ?? 0);
            const roundScoreTd = el("td", "mono", `${v >= 0 ? "+" : ""}${v}`);
            if (v > 0) {
                roundScoreTd.style.color = "#146414"; // dark green
            } else if (v < 0) {
                roundScoreTd.style.color = "#8a1212"; // dark red
            }
            tr.append(roundScoreTd);
        }

        // Total
        tr.append(el("td", "mono", String(row.total ?? row.score ?? 0)));

        return tr;
    }

    // TBODY target: clear and append rows
    if (isTbody) {
        targetEl.textContent = "";
        const totalRows = rows.length;
        for (const r of rows) targetEl.append(buildRow(r, totalRows));
        return;
    }

    // Full table target (container)
    targetEl.textContent = "";
    if (title) targetEl.append(el("h2", null, title));

    const table = el("table", "table");
    const thead = el("thead");
    const thr = el("tr");
    thr.append(el("th", null, "#"));
    thr.append(el("th", null, "Spieler"));
    if (showRound) thr.append(el("th", null, "Runde"));
    thr.append(el("th", null, "Gesamt"));
    thead.append(thr);
    table.append(thead);

    const tbody = el("tbody");
    const totalRows = rows.length;
    for (const r of rows) tbody.append(buildRow(r, totalRows));
    table.append(tbody);

    targetEl.append(table);
}
/* ————— Render ————— */
function render(state){
    // Karten-Header + Stiche-Anzeige
    const totalGoals = (state.goals || []).reduce((a, b) => a + (b || 0), 0);
    const cardsVal = state.cards ?? "–";
    let text = `Karten: ${cardsVal}`;
    if (state.cards && state.goals && state.goals.length) {
        text += `&nbsp;&nbsp;&nbsp;Stiche: ${totalGoals}`;
    }
    $cards.innerHTML = text;

    // Spieler nach Goal absteigend (links->rechts)
    const players = [...(state.players || [])].map((p, i) => ({
        pref: p.pref,
        name: normalizeName(p.name) || (p.pref || "").toUpperCase(),
        goal: (state.goals || [])[i] ?? 0,
        reached: (state.reached || [])[i] ?? 0,
    })).sort((a, b) => b.goal - a.goal);

    // Preview-Score (inkl. +o-Bonus, auch 0/0 => +20) kommt direkt vom Backend im Feld preview_scores
    const preview = state.preview_scores || [];

    // Render Player cards
    $players.textContent = "";
    for (let idx = 0; idx < players.length; idx++){
        const p = players[idx];

        // Index im Original-Array über normalisierte Namen/Prefs ermitteln
        const originalIndex = (state.players || []).findIndex(sp => {
            const spDisplay = normalizeName(sp.name) || (sp.pref || "").toUpperCase();
            const pKey = nameKey(p.name || p.pref);
            const spKey = nameKey(spDisplay || sp.pref);
            return pKey === spKey;
        });

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

            // Build name → { goal, reached } for last round from current state arrays
            const roundLookup = {};
            if (Array.isArray(state.players)) {
                (state.players || []).forEach((p, i) => {
                    const display = normalizeName(p.name) || (p.pref || "").toUpperCase();
                    roundLookup[nameKey(display)] = {
                        goal: (state.goals || [])[i],
                        reached: (state.reached || [])[i]
                    };
                });
            }
            renderStandingsTable($waitBody, lr.items, {
                showRound: true,
                roundLookup
            });

        } else {
            $waitSummary.classList.add("hidden");
        }
    } else {
        $wait.classList.remove("show");
    }

    // Totals-Modal (nur Totals, kein Rundenscore) — render via central function
    if (state.modal && state.modal.kind === "totals"){
        // Build rows from computeStandings using modal as source
        const modalRows = computeStandings({
            players: [],        // leeres players -> computeStandings nimmt modal.items
            modal: state.modal
        });
        renderStandingsTable($modalContent, modalRows, {
            showRound: false,
            title: "Stand:",
            podiumColors: true
        });
        $modal.classList.add("show");
    } else {
        $modal.classList.remove("show");
    }

    // Always-on scores panel (einheitliche Logik aus allen Quellen) — central renderer to tbody
    renderStandingsTable($scoresBody, computeStandings(state), {
        showRound: false,
        podiumColors: true
    });
}

function computeStandings(state){
    // Key = normalisierter Name (lowercased), Value = total
    const totalsByKey = new Map();
    const displayNameByKey = new Map();

    const setTotal = (name, total) => {
        const key = nameKey(name);
        totalsByKey.set(key, Number(total) || 0);
        if (!displayNameByKey.has(key)) displayNameByKey.set(key, normalizeName(name));
    };

    // Sammle Totals aus allen möglichen Quellen (Priorität egal, wird später sortiert)
    if (Array.isArray(state.totals)) {
        for (const r of state.totals) setTotal(r.name, r.score);
    }
    if (state.last_round && Array.isArray(state.last_round.items)) {
        for (const r of state.last_round.items) setTotal(r.name, r.total);
    }
    if (state.modal && state.modal.kind === "totals" && Array.isArray(state.modal.items)) {
        for (const r of state.modal.items) setTotal(r.name, r.score);
    }

    let rows = [];

    // Wenn Spieler-Infos da sind, nutze sie als Basis (damit auch Spieler ohne Totals angezeigt werden)
    if (Array.isArray(state.players) && state.players.length) {
        rows = state.players.map(p => {
            const display = normalizeName(p.name) || (p.pref || "").toUpperCase();
            const key = nameKey(p.name || p.pref);
            const total = totalsByKey.has(key) ? totalsByKey.get(key) : 0;
            return { name: display, total };
        });
    } else {
        // Falls noch keine Spieler im State → direkt Totals-Liste verwenden
        rows = Array.from(totalsByKey.entries()).map(([key, total]) => ({
            name: displayNameByKey.get(key) || key,
            total
        }));
    }

    // Sortieren nach Total desc, dann Name
    rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    // Platzierungen vergeben (gleiche Punkte = gleiche Platznummer)
    let prevTotal = null, place = 0;
    for (let i = 0; i < rows.length; i++) {
        if (prevTotal === null || rows[i].total < prevTotal) place = i + 1;
        rows[i].place = place;
        prevTotal = rows[i].total;
    }

    return rows;
}

function showNextBanner() {
    if (bannerOpen || eventQueue.length === 0) return;
    const e = eventQueue.shift();

    // Special case: don't show the banner for "Nächste Runde gestartet"
    if (/Nächste Runde gestartet/i.test(e.text)) {
        playSound("roundEnd", 0.7);
        setTimeout(showNextBanner, 50);
        return;
    }

    bannerOpen = true;
    const startTime = Date.now();

    $banner.className = "banner show " + (e.color || "gray");
    $bannerText.textContent = e.text;

    if (/zielt/i.test(e.text)) {
        const match = e.text.match(/\d+/);
        const count = match ? parseInt(match[0], 10) : 0;
        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                playSound("goal", 1);
            }, i * 100); // 100ms stagger for strong overlap
        }
    } else if (/nimmt den Stapel/i.test(e.text)) {
        playSound("stack", 1);
    }

    if (hideTimer) clearTimeout(hideTimer);

    hideTimer = setTimeout(function cycle() {
        const elapsed = Date.now() - startTime;

        if (eventQueue.length > 0 && elapsed >= 1000) {
            // Queue waiting, min 1s shown → move on instantly
            $banner.className = "banner hidden";
            bannerOpen = false;
            setTimeout(showNextBanner, 50);
        } else if (eventQueue.length === 0 && elapsed < 3000) {
            // Nothing waiting, keep banner until 3s
            hideTimer = setTimeout(cycle, 100);
        } else {
            // 3s passed or no queue left → hide
            $banner.className = "banner hidden";
            bannerOpen = false;
            setTimeout(showNextBanner, 50);
        }
    }, 1000); // first check after 1s
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
