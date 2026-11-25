# Duelo de Acción de Gracias

Party game for 8 adults, each on their own phone. Everything players see is in Spanish (all text lives in `public/es.js`).

## Run it

```bash
cd ~/Desktop/duelo-accion-de-gracias
npm install        # first time only
npm start
```

The console prints the room code and the links to open, for example:

```
Código de sala: KRTM
Abre en los teléfonos: http://192.168.1.23:3000/?c=KRTM
```

New game (wipes saved state): `npm run nuevo`. Fixed room code: `ROOM_CODE=PAVO npm start`. Other port: `PORT=8080 npm start`.

If `npm install` fails with an EACCES error on `~/.npm` (root-owned cache), run it with a throwaway cache instead:
`npm install --cache /tmp/npm-cache`

## Getting phones in

**Same wifi (easiest):** all phones and this computer on the same network, then open the `http://192.168.x.x:3000/?c=CODE` link printed by the server (the `?c=` part pre-fills the room code). Send it by WhatsApp or show a QR. If phones can't connect, the guest-wifi "client isolation" setting or the macOS firewall is usually the cause; allow `node` in System Settings → Network → Firewall.

**Free tunnel (different networks / guest wifi):**

```bash
# Cloudflare Tunnel, no account needed
brew install cloudflared
cloudflared tunnel --url http://localhost:3000
```

```bash
# or ngrok
ngrok http 3000
```

Share the `https://…` URL the tool prints, adding `/?c=CODE`. WebSockets work through both.

## How a night goes

1. The **first person to join is the host** (and also a player). Everyone else joins with a name and the room code.
2. Host opens the **Anfitrión** tab/panel and moves through the parts in any order:
   1. *Encuesta familiar*: edit the 6 prompts if you like, start. Everyone answers privately (40 chars max).
   2. *Adivina la respuesta más popular*: one prompt at a time; players type a guess, host reveals. Points = how many people gave the answer you matched (ignores case, accents, ñ, articles like "el/la", and plurals: "papas" = "papa").
   3. *Misiones secretas* (dinner): each phone gets 4 secret missions (10/20/20/30 pts). Tap **¡Lista!**, pick a witness; points only count once the witness confirms on their phone.
   4. *Cuenta la historia* (dessert): each phone starts a different story; each person adds one sentence (60 chars) seeing only the previous one, and stories rotate until every story has one sentence from everyone. Then each story is shown, everyone votes for the funniest sentence (not their own), authors get 10 pts per vote.
3. **Terminar juego** shows the podium and a points-per-mode table.

The live leaderboard is the strip at the top of every phone (tap it to expand).

## Notes

- State is kept in memory and saved to `state.json`. A refresh or reconnect restores the player (id stored in `localStorage`). If the server restarts it picks up where it left off.
- Duplicate names: rejected while that person is connected. If they dropped, typing the same name reclaims their seat.
- If someone's phone dies during the story round, the host taps **Avanzar sin esperar** and their missing sentence is skipped.
- Max 12 players. No accounts or passwords; this is meant for a living room, not the open internet.

## Test (8 simulated clients)

```bash
npm test
```

Starts a real server on port 3199 and plays a whole game with 8 WebSocket clients (join, duplicate/empty answers, survey grouping, guesses, missions with witness, disconnect/reconnect, server restart, story rounds, votes, winner screen).
