import os, threading, time, json
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlsplit
from pathlib import Path
import time

# --- SCORING ---
OFF_PENALTY = 10
POINT_BONUS = 10
HIT_BONUS = 20

# --- ANSI ---
RESET = "\033[0m"; WHITE = "\033[97m"; GREEN = "\033[92m"; RED = "\033[91m"; BOLD = "\033[1m"

# --- WEB ---
WEB_HOST = "0.0.0.0"
WEB_PORT = 8020

WEB_STATE = {
    "cards": 0,
    "players": [],          # [{pref,name}]
    "goals": [],
    "reached": [],
    "preview_scores": [],   # mit +o-Bonus (0/0 => +20)
    "events": [],           # [{seq,text,color,ts}]
    "modal": None,          # {"kind":"totals","items":[{place,name,score}]}
    "wait": True,           # Start: warten bis erste Eingabe
    "last_round": None,     # {"items":[{place,name,round_score,total}]}
    "totals": [],           # persistente Totals für Always-on
}
_state_lock = threading.Lock()
_event_seq = 0

# ----- helpers -----
def _ensure_players_for_web(players):
    out = []
    for p in players:
        if not isinstance(p, (list, tuple)) or len(p) < 2:
            continue
        pref = str(p[0])
        name = str(p[1]).strip()
        out.append({"pref": pref, "name": name})
    return out

def score_round_per_player(goals, reached):
    scores = []
    for g, r in zip(goals, reached):
        if r == g:
            if g == 0:
                score = HIT_BONUS
            else:
                score = (r * POINT_BONUS) + HIT_BONUS
        elif r < g:
            score = -(g - r) * OFF_PENALTY
        else:
            score = -(r - g) * OFF_PENALTY
        scores.append(score)
    return scores

def score_preview_with_bonus(goals, reached):
    scores = []
    for g, r in zip(goals, reached):
        if r < g:
            scores.append(-(g - r) * OFF_PENALTY)
        elif r == g:
            if g == 0:
                scores.append(HIT_BONUS)
            else:
                scores.append(r * POINT_BONUS + HIT_BONUS)
        else:
            scores.append(-(r - g) * OFF_PENALTY)
    return scores

def update_web_state(cards, players, goals, reached):
    with _state_lock:
        WEB_STATE["cards"] = cards
        WEB_STATE["players"] = _ensure_players_for_web(players)
        WEB_STATE["goals"] = list(goals)
        WEB_STATE["reached"] = list(reached)
        WEB_STATE["preview_scores"] = score_preview_with_bonus(goals, reached)

def push_event(text, color="gray", particles=False):
    global _event_seq
    with _state_lock:
        _event_seq += 1
        WEB_STATE["events"].append({
            "seq": _event_seq,
            "text": text,
            "color": color,
            "ts": time.time(),
            "particles": particles
        })
        if len(WEB_STATE["events"]) > 100:
            WEB_STATE["events"] = WEB_STATE["events"][-100:]
def set_wait(active: bool):
    with _state_lock:
        WEB_STATE["wait"] = bool(active)

def set_modal_totals(items):
    with _state_lock:
        WEB_STATE["modal"] = {"kind": "totals", "items": items}

def clear_modal():
    with _state_lock:
        WEB_STATE["modal"] = None

def set_last_round_summary(items_or_none):
    with _state_lock:
        WEB_STATE["last_round"] = items_or_none

def set_totals(players, totals_list):
    with _state_lock:
        WEB_STATE["totals"] = [
            {"name": (name.strip() or pref.upper()), "score": int(score)}
            for (pref, name), score in zip(players, totals_list)
        ]

def recompute_and_push_totals(name, players):
    totals = compute_totals_from_file(name, players)
    set_totals(players, totals)

# ----- HTTP -----
class WizHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args): return

    def _send_bytes(self, code, data: bytes, ctype="text/plain; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def _send_file(self, filename: str, fallback: str = ""):
        p = Path(filename)
        if p.exists():
            data = p.read_bytes()
            if filename.endswith(".html"): ctype = "text/html; charset=utf-8"
            elif filename.endswith(".css"): ctype = "text/css; charset=utf-8"
            elif filename.endswith(".js"): ctype = "application/javascript; charset=utf-8"
            else: ctype = "application/octet-stream"
            self._send_bytes(200, data, ctype)
        else:
            self._send_bytes(200, fallback.encode("utf-8"), "text/plain; charset=utf-8")

    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith("/sounds/"):
            return self._send_file(path.lstrip("/"))
        if path in ("/", "/index.html"): return self._send_file("index.html", "<h1>index.html fehlt</h1>")
        if path == "/styles.css": return self._send_file("styles.css", "/* styles.css fehlt */")
        if path == "/script.js": return self._send_file("script.js", "// script.js fehlt")
        if path == "/state":
            with _state_lock:
                snapshot = dict(WEB_STATE)
                now = time.time()
                snapshot["events"] = [e for e in snapshot.get("events", []) if now - e["ts"] < 300]
            return self._send_bytes(200, json.dumps(snapshot, ensure_ascii=False).encode("utf-8"),
                                    "application/json; charset=utf-8")
        self.send_response(404); self.end_headers()

def start_web_server():
    def run():
        httpd = ThreadingHTTPServer((WEB_HOST, WEB_PORT), WizHandler)
        print(f"{WHITE}Webview auf Port {WEB_PORT} aktiv.{RESET}")
        httpd.serve_forever()
    threading.Thread(target=run, daemon=True).start()

# ----- Terminal-Logik -----
def clear(): os.system("clear")

def open_wiz(name, ind):
    filename = f"{name}.wiz"
    with open(filename, "r", encoding="utf-8") as f: content = f.read()
    parts = content.split("\n\n", 1)
    if len(parts) < 2: parts.append("")
    return parts[ind].splitlines()

def init_game(n):
    players = []
    while True:
        name = input("player:\n> ").strip()
        if not name: break
        short = input("p:\n> ").strip()
        players.append((short, name))
    with open(f"{n}.wiz", "w", encoding="utf-8") as f:
        for short, name in players: f.write(f"{short} {name}\n")
        f.write("\n")
    print("done.")

def append_game(name, game):
    filename = f"{name}.wiz"
    with open(filename, "r", encoding="utf-8") as f: content = f.read()
    parts = content.split("\n\n", 1)
    players, games = (parts[0], "") if len(parts) == 1 else parts
    new_line = " ".join(game)
    games = (games.strip() + "\n" + new_line).strip()
    new_content = players.strip() + "\n\n" + games.strip() + "\n"
    with open(filename, "w", encoding="utf-8") as f: f.write(new_content)

def init_var_players(name):
    player_lines = open_wiz(name, 0)
    players = []
    for line in player_lines:
        if not line: continue
        a = line[0]; b = line[1:]
        players.append([a, b])
    return players

def find_associating(players, gm, isgoal):
    for i, player in enumerate(players):
        if isgoal:
            if player[0] == gm[0]: return i
        else:
            if len(gm) > 1 and player[0] == gm[1]: return i
    return -1

def build_initial_state(players):
    goals = [0 for _ in players]; reached = [0 for _ in players]; return goals, reached

def push_event_token(template, color, players, idx):
    pname = players[idx][1].strip() or players[idx][0].upper()
    push_event(template.format(spieler=pname), color)

def apply_game_step(players, gm, goals, reached):
    if not gm:
        return

    # check auf "jj" (Partikel-Event)
    particles = False
    token = gm
    if len(gm) >= 2 and gm[0] == gm[1]:
        particles = True
        token = gm[0] + gm[2:]   # doppeltes Prefix auf normales Kürzel reduzieren

    if token[0] == 'l':
        idx = find_associating(players, token, False)
        if idx != -1:
            reached[idx] -= 1
            push_event_token("{spieler} Punkt verloren", "red", players, idx)
            set_wait(False)
        return

    idx = find_associating(players, token, True)
    if idx == -1:
        return

    if not token[1:].isdigit():
        # Stapelaufnahme
        reached[idx] += 1
        g = goals[idx]
        r = reached[idx]
        pname = players[idx][1].strip() or players[idx][0].upper()

        if g > 0 and r == g:
            text = f"{pname} hat die Stiche erreicht"
        elif r > g:
            text = f"{pname} hat die Stiche überschritten"
        else:
            text = f"{pname} nimmt den Stapel"

        push_event(text, "gold", particles=particles)   # <--- hier Flag setzen
        set_wait(False)

    else:
        # Zielansage
        goals[idx] = int(token[1:])
        push_event_token("{spieler} zielt " + str(goals[idx]) + " Stiche an", "gray", players, idx)
        set_wait(False)

def colorize_progress(s: str) -> str:
    s = s.replace("+o", f"{GREEN}+o{RESET}").replace("O ", f"{GREEN}O {RESET}") \
         .replace("x ", f"{RED}x {RESET}").replace("X ", f"{RED}X {RESET}") \
         .replace("_ ", f"{WHITE}_ {RESET}")
    return s

def render(cards, players, goals, reached):
    update_web_state(cards, players, goals, reached)
    clear(); print(f"{WHITE}cards: {cards}{RESET}")
    asso = [[x, goals[i], reached[i]] for i, x in enumerate(players)]
    asso = sorted(asso, key=lambda x: x[1], reverse=True)
    lines = []
    for ass in asso:
        todo = ass[1] - ass[2]; done = ass[2]
        if todo < 0: string = "_ " * ass[1] + "X " * (ass[2] - ass[1])
        elif todo == 0: string = "O " * done + "x " * todo + " +o"
        else: string = "_ " * done + "x " * todo
        ind = 10 - len(ass[0][1]); colored_bar = colorize_progress(string)
        lines.append(f"{WHITE}{ass[0][1] + ind * ' '}: {RESET}{colored_bar}")
    for line in lines: print(line)

def tokens_for_round(players, scores):
    return [f"{pref}{sc}" for (pref, _name), sc in zip(players, scores)]

def compute_totals_from_file(name, players):
    lines = open_wiz(name, 1)
    totals_by_pref = {p[0]: 0 for p in players}
    for line in lines:
        if not line.strip(): continue
        for tok in line.split():
            pref = tok[0]
            try: val = int(tok[1:])
            except ValueError: continue
            if pref in totals_by_pref:
                totals_by_pref[pref] += val
    return [totals_by_pref[p[0]] for p in players]

def existing_completed_rounds_count(name):
    return sum(1 for ln in open_wiz(name, 1) if ln.strip())

def show_totals_sorted(name, players):
    clear()
    totals = compute_totals_from_file(name, players)
    idxs = sorted(range(len(players)), key=lambda i: totals[i], reverse=True)
    print(f"{WHITE}{BOLD}totals:{RESET}")
    prev_score = None
    place = 0
    items = []
    for i in idxs:
        score = totals[i]
        if prev_score is None or score != prev_score:
            place += 1
            prev_score = score
        pref, pname = players[i]
        ind = 10 - len(pname)
        score_color = GREEN if score > 0 else RED if score < 0 else WHITE
        line_left = f"{place}. {pname + ind * ' '}: "
        print(f"{WHITE}{line_left}{RESET}{score_color}{score}{RESET}")
        items.append({"place": place, "name": pname.strip() or pref.upper(), "score": score})
    set_modal_totals(items)
    set_totals(players, totals)
    set_wait(False)

def build_last_round_summary(name, players, round_scores, goals, reached):
    totals = compute_totals_from_file(name, players)
    idxs = sorted(range(len(players)), key=lambda i: totals[i], reverse=True)
    by_index_round = {i: round_scores[i] for i in range(len(players))}
    prev = None; place = 0; items = []
    for i in idxs:
        if prev is None or totals[i] != prev:
            place += 1
            prev = totals[i]
        pref, pname = players[i]
        items.append({
            "place": place,
            "name": (pname.strip() or pref.upper()),
            "round_score": int(by_index_round.get(i, 0)),
            "total": int(totals[i]),
            "goal": int(goals[i]) if i < len(goals) else 0,
            "reached": int(reached[i]) if i < len(reached) else 0,
        })
    return {"items": items}

# --- MAIN LOOP ---
def gameplay_loop(name):
    players = init_var_players(name)
    completed = existing_completed_rounds_count(name)
    i = completed + 1
    goals, reached = build_initial_state(players)

    set_wait(True)
    set_last_round_summary(None)
    update_web_state(i, players, goals, reached)
    recompute_and_push_totals(name, players)

    print(players)
    while 1:
        render(i, players, goals, reached)
        inp_raw = input("> ").strip()
        inp = inp_raw.lower()
        if inp == "next":
            scores = score_round_per_player(goals, reached)
            toks = tokens_for_round(players, scores)
            append_game(name, toks)
            lr = build_last_round_summary(name, players, scores, goals, reached)
            set_last_round_summary(lr)
            recompute_and_push_totals(name, players)
            goals, reached = build_initial_state(players)  # reset
            i += 1
            update_web_state(i, players, goals, reached)
            set_wait(True)
            push_event("Nächste Runde gestartet", "gray")
        elif inp == "view":
            show_totals_sorted(name, players)
            input(f"{WHITE}(press enter to continue){RESET}")
            clear_modal()

        elif inp == "exit":
            return
        else:
            apply_game_step(players, inp_raw, goals, reached)
            update_web_state(i, players, goals, reached)

# --- ENTRY ---
start_web_server()
time.sleep(1)
act = input("action?\n> ").strip()
if act == "n":
    init_game(input("title\n> ").strip())
elif act == "p":
    name = input("title\n> ").strip()
    gameplay_loop(name)
