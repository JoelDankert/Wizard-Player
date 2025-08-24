import glob
from collections import defaultdict

# --- CONFIG ---
game_files = glob.glob("*.wiz")

# --- FUNCTIONS ---
def load_mapping(file_path):
    mapping = {}
    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if " " in line:  # mapping line
                parts = line.split()
                if len(parts) == 2:
                    key, name = parts
                    mapping[key] = name
            else:
                break
    return mapping

def load_games(file_path, mapping):
    scores = defaultdict(int)
    rounds = []
    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or " " not in line:
                continue
            round_scores = {}
            parts = line.split()
            for part in parts:
                k = part[0]
                num_str = part[1:]
                if not num_str:
                    continue
                try:
                    v = int(num_str)
                except ValueError:
                    continue
                name = mapping.get(k, k)
                if name in mapping.values():
                    round_scores[name] = v
                    scores[name] += v
            if round_scores:
                rounds.append(round_scores)
    return scores, rounds

def print_top(title, data, reverse=True, limit=3):
    items = sorted(data.items(), key=lambda x: x[1], reverse=reverse)[:limit]
    print(f"\n{title}:")
    for name, val in items:
        print(f"  {name:<10} {round(val, 1)}")

def compute_stats(all_games, rounds_per_game, mapping):
    game_wins = defaultdict(int)
    game_losses = defaultdict(int)
    total_scores = defaultdict(list)
    pos_rounds = defaultdict(int)
    neg_rounds = defaultdict(int)

    valid_names = set(mapping.values())

    for g_idx, scores in enumerate(all_games):
        scores = {n: s for n, s in scores.items() if n in valid_names}
        if not scores:
            continue
        max_score = max(scores.values())
        min_score = min(scores.values())
        for name, score in scores.items():
            total_scores[name].append(score)
            if score == max_score:
                game_wins[name] += 1
            if score == min_score:
                game_losses[name] += 1

        for rnd in rounds_per_game[g_idx]:
            for name, val in rnd.items():
                if name not in valid_names:
                    continue
                if val >= 0:
                    pos_rounds[name] += 1
                else:
                    neg_rounds[name] += 1

    avg_scores = {name: sum(vals)/len(vals) for name, vals in total_scores.items() if vals}

    # --- normal stats ---
    print_top("Most games won", game_wins)
    print_top("Most games lost", game_losses)
    print_top("Highest avg score", avg_scores, reverse=True)
    print_top("Lowest avg score", avg_scores, reverse=False)
    print_top("Most positive rounds", pos_rounds)
    print_top("Most negative rounds", neg_rounds)

    # --- satisfaction stats ---
    satisfaction = {}
    for name in valid_names:
        wins = game_wins.get(name, 0)
        losses = game_losses.get(name, 0)
        avg = avg_scores.get(name, 0)
        pos = pos_rounds.get(name, 0)
        neg = neg_rounds.get(name, 0)

        score = (wins * 3) + (losses * -2) + (avg * 0.05) + (pos * 0.5) + (neg * -0.5)
        satisfaction[name] = score

    print_top("Most satisfied players", satisfaction)
    print_top("Least satisfied players", satisfaction, reverse=False)


# --- MAIN ---
if not game_files:
    print("No .wiz game files found in current directory.")
    exit()

mapping = load_mapping(game_files[0])

all_games = []
rounds_per_game = []

for file in game_files:
    scores, rounds = load_games(file, mapping)
    all_games.append(scores)
    rounds_per_game.append(rounds)

compute_stats(all_games, rounds_per_game, mapping)
