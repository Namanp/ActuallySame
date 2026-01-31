# Texas Hold'em Night

A lightweight multiplayer Texas Hold'em room powered by Express + Socket.IO. Create a table with blinds and buy-in limits, then share the room code to bring friends in.

## Features
- Create a table with min/max buy-in and blinds (up to 9 players).
- Each player chooses their starting stack within the table limits.
- All connected players must ready up before the host can deal.
- Dealer, small blind, and big blind positions rotate each hand.
- Betting actions support check, call, fold, and raise with minimum raise rules.

## Getting started

```bash
npm install
npm start
```

Visit `http://localhost:3000`, create a table, and share the room code with friends.
