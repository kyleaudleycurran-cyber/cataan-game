# Cataan · House Table

A browser game for 2–4 friends, built around a familiar hex island and a commodity market with binding resource futures. The two-player option is a house variant. One Node server hosts the table; every player joins in their own browser.

## Run it

Requires **Node.js 22 or newer**. The game server has **no npm dependencies**.

~~~sh
git clone https://github.com/kyleaudleycurran-cyber/cataan-game.git
cd cataan-game
npm start
~~~

Open **http://localhost:3000**, enter a name, and create a table. Share the room link with friends, let them join, adjust the house rules, and start. Use separate browsers or private windows when testing multiple players on one computer. A returning browser remembers its seat.

Friends on the same network can use your computer's network address with port 3000. Friends on other networks need a running deployment reachable over the internet; deploy this Node application or its Docker image on a host with HTTPS and persistent storage. This repository is source code, not a live game server. GitHub Pages cannot run the multiplayer API.

### Docker

~~~sh
docker compose up --build -d
~~~

Open **http://localhost:3000**. The Compose volume preserves room snapshots across restarts.

### Server settings

| Setting | Default | Purpose |
| --- | --- | --- |
| PORT | 3000 | HTTP listen port |
| HOST | 0.0.0.0 | Listen address |
| DATA_DIR | ./data | Private room snapshots and seat credentials |

Mount DATA_DIR on durable storage in production. Use one server instance for a given data directory: rooms live in server memory and are snapshotted after accepted actions. Multiple independent replicas are not supported. Room files contain all hands and seat tokens; keep them private. The static server exposes only the public application assets.

## Play

The game includes:

- A shuffled 19-tile island, 54 intersections, 72 edges, and nine ports.
- Snake-order initial settlements and roads; starting resources from the second settlement.
- Dice production, bank shortages, ports, player trades, and bank trades.
- Roads, settlements, city upgrades, Longest Road, Largest Army, and configurable victory points.
- Sevens, exact resource discards, robber movement, and theft.
- Knights, road building, year of plenty, monopoly, and hidden victory point development cards.
- A private hand per player, shared activity history, invite links, and reconnects.

The active player rolls, resolves mandatory actions, then builds and trades before ending the turn. Click a build tool and a highlighted location on the board. Highlighted locations are also keyboard accessible.

The commodity market is available to **all players during any player's roll or build phase**, including before the dice roll. Mandatory discards, robber actions, free-road placement, and initial setup pause the market. Offers remain available across turns until accepted or cancelled. The server rechecks the offer when it is accepted.

## The original house rules

### Any incoming resource settles a future

A future reserves a numbered incoming delivery of a particular resource from one player to another. It is a binding obligation once both parties accept.

For example:

1. Alice offers Bob **one wheat now**.
2. Bob promises Alice **his next two wheat deliveries**.
3. On acceptance, Bob receives Alice's wheat.
4. Bob's next two incoming wheats are automatically forwarded to Alice.

Incoming resources include board production, player trades, bank exchanges, theft, development cards, and payments received from another future. The game applies existing claims before a received card reaches the player's spendable hand.

**Transaction convention:** new futures begin after the immediate payments in the accepting trade, including any settlements caused by those payments. The wheat Alice pays in the example does not immediately bounce back under the newly created contract. Relative delivery numbers are evaluated at acceptance.

In the offer dialog, select **Add future deliveries**, the resource, a starting delivery number, and a quantity. Start 1 / quantity 2 means the next two deliveries. Start 3 / quantity 2 reserves the third and fourth deliveries and leaves the first two alone.

- A delivery slot cannot be promised twice.
- Proposed offers do not reserve slots; accepted contracts do.
- Offers can mix current cards and several ranges of future deliveries.
- Immediate payments must be covered by cards already in each payer's hand.
- Accepting a trade is atomic. A conflict or insufficient inventory cancels the entire attempt.
- Chained futures settle automatically. Each claim is consumed before forwarding its card, so even circular obligations terminate without copying resources.
- An outstanding claim cannot be cancelled or reassigned in this first version.
- The current bounds are five ranges per side, ten cards per range, offsets up to 100, and 200 outstanding delivery slots.

### Road renovation

The active player can select **Renovate**, choose an existing road, and choose a legal highlighted destination.

The original renovation price was not remembered, so the initial rule pack uses a **provisional price of one brick**. The host can change every resource in this price before starting, including making renovation free.

Normal road placement restrictions apply at the destination. By default, a renovation must preserve connections among the player's remaining roads and buildings that were connected before the move. It can relocate a terminal road without requiring the player's separate initial networks to become one network. The connection rule is adjustable.

The old road piece is reused, the renovation cost goes back to the bank, and Longest Road is recalculated.

## Mod the game

Open **House rules** in the room lobby. Simple controls cover victory points, the bank ratio, the hand threshold on a seven, futures, trading on any turn, renovation prices, and preserving road connections.

Use **Advanced rule pack** to change build costs as well. Import or export JSON to share a setup. Rules lock at game start. Importing a file does not apply it until the host saves.

~~~json
{
  "targetPoints": 10,
  "bankTradeRatio": 4,
  "discardLimit": 7,
  "futuresEnabled": true,
  "tradeOnAnyTurn": true,
  "preserveRoadConnections": true,
  "renovationCost": { "brick": 1 },
  "costs": {
    "road": { "wood": 1, "brick": 1 },
    "settlement": { "wood": 1, "brick": 1, "wool": 1, "grain": 1 },
    "city": { "grain": 2, "ore": 3 },
    "development": { "wool": 1, "grain": 1, "ore": 1 }
  }
}
~~~

The JSON resource name grain is displayed as **Wheat** in the interface. Rule packs are data, not executable JavaScript.

For larger rule changes:

| File | Responsibility |
| --- | --- |
| src/rules.mjs | Rule defaults, resource names, and validation |
| src/market.mjs | Resource intake, future settlement, and trade execution |
| src/board.mjs | Map generation, road connections, placement, and Longest Road |
| src/game.mjs | Pure action reducer, turns, development cards, scoring, and private views |
| server.mjs | Authoritative room server, seat authentication, revisions, and persistence |
| public/app.mjs | Browser interface and room polling |
| public/styles.css | Responsive visual design |
| tests/ | Rules, multiplayer API, and browser checks |

Keep every new resource gain routed through credit in src/market.mjs so futures apply consistently. applyAction clones the previous state and only returns a new state after the whole action succeeds. Do not move authoritative checks into the browser.

## Verify

~~~sh
npm run check
npm test
~~~

GitHub Actions also installs Playwright, opens two independent browsers, creates and joins a room, edits rules, completes setup, accepts an off-turn futures trade, checks mobile width, and verifies reconnects. Desktop and mobile screenshots are uploaded as the **browser-captures** artifact.

To run the browser smoke test yourself:

~~~sh
npm install --no-save --package-lock=false playwright@1.56.1
npx playwright install chromium
node tests/browser-smoke.mjs
~~~

## First-version scope

No bots, matchmaking, account system, spectators, midgame player replacement, or expansion boards are included. A room supports one ongoing game; create another table for a new game. Hosting and browser screenshots still need to be reviewed on the chosen deployment. The app uses original SVG/CSS visuals and no official game artwork.
