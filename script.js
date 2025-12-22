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
    goal: new Audio("sounds/goal.mp3"),
    stack: new Audio("sounds/stack.mp3"),
    roundEnd: new Audio("sounds/roundend.mp3"),
    applause: new Audio("sounds/applause.mp3"),
    sad: new Audio("sounds/sad.mp3"),
    wizard: new Audio("sounds/wizard.mp3"),   // NEU
};

let lastSeq = 0;
let initialized = false;

// Queue für Events (alle nacheinander)
const eventQueue = [];
let bannerOpen = false;
let hideTimer = null;

/* ————— Helpers ————— */
function stripLeadingEmoji(s){
  const raw = normalizeName(s) || "";
  const m = raw.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/u);
  return m ? raw.slice(m[0].length).trim() : raw;
}
function triggerParticles(avatarEmoji) {
    const overlay = document.createElement("div");
    overlay.className = "wizard-overlay";
    overlay.textContent = "⚡ WIZARD ⚡";
    document.body.append(overlay);

    setTimeout(() => overlay.remove(), 5000);

    const container = document.createElement("div");
    container.className = "particles";
    document.body.append(container);

    const count = 100;
    for (let i = 0; i < count; i++) {
        const p = document.createElement("div");
        p.className = "particle";

        // Zufällig Blitz oder Avatar
        p.textContent = Math.random() < 0.5 ? "⚡" : (avatarEmoji || "⚡");
        container.append(p);

        const fromLeft = Math.random() < 0.5;
        const startY = -10 + Math.random() * 120;   
        const duration = 1.5 + Math.random() * 0.8; 
        const delay = Math.random() * 0.8;         
        const dist = 30 + Math.random() * 80;       

        p.style.top = startY + "%";
        p.style[fromLeft ? "left" : "right"] = "-80px";
        p.style.setProperty("--fromLeft", fromLeft ? "1" : "0");
        p.style.setProperty("--dist", dist + "vw");
        p.style.animation = `zap ${duration}s ease-out ${delay}s forwards`;
    }

    setTimeout(() => container.remove(), 5000);
}

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

function renderStandingsTable(targetEl, rows, {
    showRound = false,
    title = null,
} = {}) {
    const isTbody = targetEl && targetEl.tagName && targetEl.tagName.toUpperCase() === "TBODY";

    // Collect scores
    const roundScores = (Array.isArray(rows) ? rows : [])
        .map(r => Number(r.round_score))
        .filter(Number.isFinite);

    const totalScores = (Array.isArray(rows) ? rows : [])
        .map(r => Number(r.total ?? r.score))
        .filter(Number.isFinite);

    // Round-score stats (for ⇑/⇓ and bottom 30%)
    let maxRoundScore = null, minRoundScore = null, bottom30Threshold = null;
    if (showRound && roundScores.length) {
        const sorted = [...roundScores].sort((a, b) => a - b);
        minRoundScore = sorted[0];
        maxRoundScore = sorted[sorted.length - 1];
        const idxBottom = Math.max(0, Math.floor(sorted.length * 0.3) - 1);
        bottom30Threshold = sorted[Math.min(idxBottom, sorted.length - 1)];
    }

    // Total-score top 50% threshold (median cutoff)
    let top50TotalThreshold = null;
    if (totalScores.length) {
        const sortedT = [...totalScores].sort((a, b) => a - b);
        const idxTop50 = Math.floor(sortedT.length * 0.5); // start of top-half
        top50TotalThreshold = sortedT[Math.min(idxTop50, sortedT.length - 1)];
    }

    function buildRow(row) {
        const tr = el("tr");

        // Place (visual only)
        const pos = el("td");
        pos.append(el("span", "badge-pos", String(row.place ?? "")));
        tr.append(pos);

        // Name + indicators
        let rawName = row.name ?? "";
        let emojiMatch = rawName.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/u);
        let avatar = null;
        let displayName = normalizeName(rawName);

        if (emojiMatch) {
            avatar = emojiMatch[0];
            displayName = normalizeName(rawName.slice(avatar.length).trim());
        }

        const nameCell = el("td", null);

        if (avatar) {
            // Emoji + forced double space + name
            nameCell.textContent = avatar + "\u00A0\u00A0" + displayName;
        } else {
            nameCell.textContent = displayName;
        }
        const nameIndicators = [];
        const scoreIndicators = [];

        if (showRound) {
            const v = Number(row.round_score);
            const totalV = Number(row.total ?? row.score);

            if (Number.isFinite(v)) {
                // Score cell indicators
                if (v === maxRoundScore && v > 0) scoreIndicators.push("⇑");
                if (v === minRoundScore && v < 0) scoreIndicators.push("⇓");

                // ⇅ shown ONLY when: total in top 50% AND round in bottom 30%
                if (
                    bottom30Threshold != null &&
                    top50TotalThreshold != null &&
                    v <= bottom30Threshold &&
                    Number.isFinite(totalV) &&
                    totalV >= top50TotalThreshold &&
                    v < 0
                ) {
                    nameIndicators.push("⇅");
                }
            }

            // ⤵ underestimated: goal < reached
            const g = Number(row.goal);
            const r = Number(row.reached);
            if (Number.isFinite(g) && Number.isFinite(r) && g < r) {
                nameIndicators.push("⤵");
            }
        }

        if (nameIndicators.length) {
            nameCell.textContent += " " + nameIndicators.join(" ");
        }
        tr.append(nameCell);

        // Round score cell
        if (showRound) {
            const v = Number(row.round_score ?? 0);
            const roundScoreTd = el("td", "mono", `${v >= 0 ? "+" : ""}${v}`);
            if (v > 0) roundScoreTd.style.color = "#146414";
            else if (v < 0) roundScoreTd.style.color = "#8a1212";

            if (scoreIndicators.length) {
                roundScoreTd.textContent += " " + scoreIndicators.join(" ");
            }
            tr.append(roundScoreTd);
        }

        // Total
        tr.append(el("td", "mono", String(row.total ?? row.score ?? 0)));

        return tr;
    }

    // Render
    if (isTbody) {
        targetEl.textContent = "";
        for (const r of rows) targetEl.append(buildRow(r));
        return;
    }

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
    for (const r of rows) tbody.append(buildRow(r));
    table.append(tbody);

    targetEl.append(table);
}
/* ————— Render ————— */
function render(state){
    // Karten-Header + Stiche-Anzeige
    const totalGoals = (state.goals || []).reduce((a, b) => a + (b || 0), 0);
    const cardsVal = state.cards ?? "–";

    // Nur Dealer (kein Starter mehr anzeigen)
    const dealerName = state.dealer
        ? (stripLeadingEmoji(state.dealer.name) || (state.dealer.pref || "").toUpperCase())
        : null;


    // Spieler nach Goal absteigend (links->rechts)
    const players = [...(state.players || [])].map((p, i) => ({
        pref: p.pref,
        name: normalizeName(p.name) || (p.pref || "").toUpperCase(),
        goal: (state.goals || [])[i] ?? 0,
        reached: (state.reached || [])[i] ?? 0,
    })).sort((a, b) => b.goal - a.goal);

    // Headertext (ohne Starter)
    let maxRounds = Math.floor(60 / players.length);
    let text = `Runde: ${cardsVal} / ${maxRounds}`;

    if (state.cards && state.goals && state.goals.length) {
        text += `&nbsp;&nbsp;&nbsp;Stiche: ${totalGoals}`;
    }

    $cards.innerHTML = text;

    // Preview-Score (inkl. +o-Bonus)
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

        // Emoji vom Namen trennen (optional)
        const emojiMatch = p.name.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/u);
        let avatar = null;
        let displayName = p.name;
        if (emojiMatch) {
            avatar = emojiMatch[0];
            displayName = p.name.slice(emojiMatch[0].length).trim();
        }

        const card = el("article", "player");
        card.append(el("div", "name", displayName));

        const box = el("div", "player-box");
        const stats = el("div", "stats");
        stats.append(el("div", `bigfraction ${fractionClass(p.goal, p.reached)}`, `${p.reached}/${p.goal}`));
        stats.append(el("div", "roundpoints mono", `${rp >= 0 ? "+" : ""}${rp}`));
        box.append(stats);
        if (avatar) box.append(el("div", "avatar", avatar));
        card.append(box);
        $players.append(card);
    }

    // Wartescreen
    if (state.wait){
        $wait.classList.add("show");

        // Dealer-Hinweis (oben im Wait-Overlay, inkl. Kartenanzahl)
        const dealerMsg = document.getElementById("waitDealerMsg");
        if (dealerMsg) {
            if (dealerName) {
                let maxRounds = Math.floor(60 / players.length);
                const karteWort = cardsVal === 1 ? "Karte" : "Karten";
                dealerMsg.textContent = `${cardsVal} / ${maxRounds}\n${dealerName} verteilt ${cardsVal} ${karteWort}...`;
                dealerMsg.classList.remove("hidden");
            } else {
                dealerMsg.textContent = "";
                dealerMsg.classList.add("hidden");
            }
        }

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
        const dealerMsg = document.getElementById("waitDealerMsg");
        if (dealerMsg) dealerMsg.classList.add("hidden");
    }

    // Totals-Modal (nur Totals, kein Rundenscore)
    if (state.modal && state.modal.kind === "totals"){
        const modalRows = computeStandings({
            players: [],
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

    // Always-on scores panel
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

    if (/Nächste Runde gestartet/i.test(e.text)) {
        playSound("roundEnd", 0.7);
        setTimeout(showNextBanner, 50);
        return;
    }

    bannerOpen = true;

    const renderBanner = () => {
        const startTime = Date.now();
        $banner.className = "banner show " + (e.color || "gray");

        // Avatar + Text
        const emojiMatch = e.text.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/u);
        let avatar = null, msgText = e.text;
        if (emojiMatch) {
            avatar = emojiMatch[0];
            msgText = e.text.slice(avatar.length).trim();
        }
        $bannerText.textContent = "";
        if (avatar) $bannerText.append(el("div", "banner-avatar", avatar));
        $bannerText.append(el("div", "banner-message", msgText));

        if (/nimmt den Stapel/i.test(e.text)) playSound("stack", 1);
        else if (/Stiche erreicht/i.test(e.text)) { playSound("stack",1); playSound("applause",0.2);}
        else if (/Stiche überschritten/i.test(e.text)) { playSound("stack",1); playSound("sad",0.05);}
        else if (/zielt/i.test(e.text)) {
            const match = e.text.match(/\d+/);
            const count = match ? parseInt(match[0], 10) : 0;
            for (let i = 0; i < count; i++) setTimeout(() => playSound("goal",1), i*100);
        }

        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(function cycle() {
            const elapsed = Date.now() - startTime;
            if (eventQueue.length > 0 && elapsed >= 500) {
                $banner.className = "banner hidden";
                bannerOpen = false;
                setTimeout(showNextBanner, 50);
            } else if (eventQueue.length === 0 && elapsed < 1500) {
                hideTimer = setTimeout(cycle, 100);
            } else {
                $banner.className = "banner hidden";
                bannerOpen = false;
                setTimeout(showNextBanner, 50);
            }
        }, 500);
    };

    if (e.particles) {
        const emojiMatch = e.text.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/u);
        const avatarEmoji = emojiMatch ? emojiMatch[0] : null;

        playSound("wizard", 0.6);
        triggerParticles(avatarEmoji);

        setTimeout(() => renderBanner(), 1500);
    } else {
        renderBanner();
    }
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
