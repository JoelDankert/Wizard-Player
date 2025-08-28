import time
import random
import os
import re

colors = [
    "\033[31m",  # Red
    "\033[32m",  # Green
    "\033[33m",  # Yellow
    "\033[34m"   # Blue
]
reset = "\033[0m"

players = 7
cards = 1



def shuffle():
    cards = []
    for x in range(4):
        prep = str(x)+"-"
        cards.append(prep+"W")
        cards.append(prep+"N")
        cards.append(prep+"13")
        cards.append(prep+"12")
        cards.append(prep+"11")
        cards.append(prep+"10")
        cards.append(prep+"9")
        cards.append(prep+"8")
        cards.append(prep+"7")
        cards.append(prep+"6")
        cards.append(prep+"5")
        cards.append(prep+"4")
        cards.append(prep+"3")
        cards.append(prep+"2")
        cards.append(prep+"1")

    random.shuffle(cards)

    return cards


def render_card(cardname):
    return colors[int(cardname[0])]+cardname[2:]+reset

def color(cardname):
    return int(cardname[0])

def number(cardname):
    temp = cardname[2:]
    if temp.isdigit():
        return int(cardname[2:])
    else:
        return cardname[2:]

def handoutcards(playercount, stack, cards):
    if playercount * cards >= len(stack):
        cards = 0
    players = []
    for x in range(playercount):
        temp = stack[:cards]
        stack = stack[cards:]
        players.append(temp)

    return [players, stack]

def get_bid():
    while 1:
        bid = input("Bid:\n> ")
        if bid.isdigit():
            bid = int(bid)
            return bid
        else:
            print("err")

def clear():
    os.system("clear")

def display_players(playercount, current):
    string = ""
    for x in range(playercount):        
        string += str(x) if x != current else make_bold(str(x))

    print(string)

def make_bold(string):
    return f"\033[1m{string}\033[0m"

def filter_for_bots(available, trumpcolor, iswiz):
    newavailable = []
    if iswiz:
        for card in available:
            if number(card) not in ["W","N"]:
                newavailable.append(card)

    for card in available:
        if color(card) == trumpcolor or number(card) in ["W","N"]:
            pass
        else:
            newavailable.append(card)
            
    if len(newavailable) == 0:
        newavailable = available

    return newavailable




def get_available_cards(cards, togive):
    if togive == -1:
        return cards

    lead_suit_cards = [card for card in cards if color(card) == togive and not number(card) in ["W","N"]]

    if lead_suit_cards:
        return [card for card in cards if color(card) == togive or number(card) in ["W", "N"]]
    else:
        return cards

def who_won(lay, startingplayer, playercount, trumpcolor):
    for i, card in enumerate(lay):
        if number(card) == "W":
            return (startingplayer + i) % playercount

    winning_index = None
    winning_card = None
    for i, card in enumerate(lay):
        if number(card) == "N": 
            continue
        if color(card) == trumpcolor:
            if winning_card is None or number(card) > number(winning_card):
                winning_card = card
                winning_index = i

    if winning_index is not None:
        return (startingplayer + winning_index) % playercount

    lead_suit = None
    for card in lay:
        if number(card) != "N":
            lead_suit = color(card)
            break

    if lead_suit is None:
        return startingplayer

    winning_index = None
    winning_card = None
    for i, card in enumerate(lay):
        if number(card) != "N" and color(card) == lead_suit:
            if winning_card is None or number(card) > number(winning_card):
                winning_card = card
                winning_index = i

    return (startingplayer + winning_index) % playercount
    

def play_lay(players,trump,currentplayer):

    trumpcolor = color(trump)

    if number(trump) == "W":
        if currentplayer == 0:  
            while 1:
                inp = input("Trump? (0-R, 1-G, 2-Y, 3-B)\n> ")
                if inp.isdigit() and inp in range(4):
                    trumpcolor = inp
                    break

        else:
            trumpcolor = random.randint(0,4)


    if number(trump) == "N":
        trumpcolor = -1

    if number(trump) == "W":
        sim_trump = f"{trumpcolor}-0"


    lay = []
    playercount = len(players)
    startingplayer = currentplayer

    i = 0
    while 1:
        clear()
        if i != playercount:
            display_players(playercount, currentplayer)
        if number(trump) != "W":
            print("Trump: "+render_card(trump))
        else:
            print(f"Trump: {render_card(trump)}\nColor: {render_card(sim_trump)}")

        print("+ "+render_hand(lay))
        print()
        time.sleep(0.1)
        
        if i == playercount:
            return who_won(lay,startingplayer,playercount,trumpcolor)
        i += 1
            

        if len(lay) == 0:
            togive = -1
        else:
            lead_card = None
            for c in lay:
                if number(c) != "N":  
                    lead_card = c
                    break

            if lead_card is None:
                togive = -1
            elif number(lead_card) == "W":
                togive = -1
            else:
                togive = color(lead_card)
       

        if currentplayer != 0: # isbot
            available = get_available_cards(players[currentplayer],togive)
            iswiz = [color(c) == "W" for c in lay]
            if random.random() > 0.7:
                available = filter_for_bots(available, trumpcolor, iswiz)
            playing = random.choice(available)
            players[currentplayer].remove(playing)
            lay.append(playing)

        else:
            available = get_available_cards(players[currentplayer],togive)
            while 1:
                available = get_available_cards(players[currentplayer],togive)
                print(render_hand_available(players[currentplayer], available))
                inp = input("> ")
                if inp.isdigit():
                    playing = int(inp)
                    if playing >= len(available):
                        continue

                    playing = available[playing]

                    break
                else:
                    continue
                    
                     
            players[currentplayer].remove(playing)
        
            lay.append(playing)

        currentplayer += 1
        if currentplayer >= playercount:
            currentplayer = 0


def play_game(playercount, cardcount):
    stack = shuffle()         
    players, stack = handoutcards(playercount, stack, cardcount)

    trump = stack[0]
    stack = stack[1:]
    trumpcolor = color(trump)
    clear()
    currentplayer = random.randint(0,playercount-1)
    display_players(playercount, currentplayer)
    print("Trump: "+ render_card(trump))
    print("\nHand:")
    print(render_hand(players[0]))
    gotten = 0
    bid = get_bid() 

    while 1:
        print(f"{gotten}/{bid}")
        if len(players[0]) == 0:
            if gotten == bid:
                input("well done!\npress any key")
                break
            else:
                input("too bad...\npress any key")
                break
        input()

        whowon = play_lay(players, trump, currentplayer)
        currentplayer = whowon
        if whowon == 0:
            gotten += 1



ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')

def visible_len(s: str) -> int:
    """Return the length of the string without ANSI codes."""
    return len(ansi_escape.sub('', s))

def render_hand_available(hand, available):
    rendered = []
    playable_indices = {}
    playable_count = 0

    # prepare rendered hand and map to compact indices
    for card in hand:
        card_str = render_card(card)
        if card in available:
            card_str = make_bold(card_str)
            playable_indices[card] = str(playable_count)
            playable_count += 1
        rendered.append(card_str)

    # top line: all cards
    line_cards = " ".join(rendered)

    # bottom line: either index (for playable) or spaces
    index_parts = []
    for card_str, card in zip(rendered, hand):
        vislen = visible_len(card_str)
        if card in available:
            idx_str = playable_indices[card]
            # center index under card visually
            pad_left = (vislen - len(idx_str)) // 2
            pad_right = vislen - len(idx_str) - pad_left
            index_parts.append(" " * pad_left + idx_str + " " * pad_right)
        else:
            index_parts.append(" " * vislen)

    line_indices = " ".join(index_parts)

    return line_cards + "\n" + line_indices

def render_hand(hand):
    temp = []
    for card in hand:
        temp.append(render_card(card))

    return " ".join(temp)

# gameplay loop
while 1:
    inp = input("> ")

    if inp == "":
        play_game(players, cards)
        continue

    if inp[0] == "x":
        exit()

    if inp[0] == "c":
        temp = inp[1:]
        if temp.isdigit():
            cards = int(temp)
        else:
            print("err")
        continue

    if inp[0] == "p":
        temp = inp[1:]
        if temp.isdigit():
            players = int(temp)
        else:
            print("err")
        continue
