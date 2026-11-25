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

1. **Everyone joins on their phone** with a name, the room code and a team: **Los Pavos 🦃 (men)** or **Las Calabazas 🎃 (women)**. The **first person to join is the host** (and also a player).
2. **Put the main screen on your computer or TV:** open `http://localhost:3000/pantalla` on the computer running the server (full screen, F11). It shows the board, scores and strikes; it doesn't need a login.
3. The host opens the **Anfitrión** tab and moves through the parts in any order:
   1. *Duelo familiar* (Family Feud rules, men vs women; **the computer on `/pantalla` is the emcee**: reads the question, shows the strikes, announces each answer, optionally speaks in Spanish via the "Activar voz" button). Rounds (3–8, default 4; rounds 1–2 ×1, round 3 ×2, round 4+ ×3):
      - **Face-off:** one player per team (different players each round) races to tap **¡YO!**. The first answers; if they say the #1 answer their team wins, otherwise the rival answers and whoever gave the more popular answer wins. If neither is on the board, two new players face off.
      - **Play or pass:** the winner of the face-off chooses. The controlling team then answers one by one, rotating through the whole team (no whispering the answer!).
      - **3 strikes** → the other team gets **one chance to steal** with a single answer. Only answers that made it onto the board count.
      - **Timers:** every action has a countdown (buzz 20 s, face-off 15 s, play 25 s); running out counts as a miss.
      - If the app doesn't understand a valid answer, the host taps the right one in the list that appears after a miss.
   2. *Ronda relámpago* (Fast Money): the team with the most points (both on a tie) plays: 2 players (picked at random), 5 questions, each player gives an answer per question; the partner can't repeat the same answer. Answers are revealed one by one on the main screen; **200+ points wins the grand prize** (+50 pts for each of the two players).
   3. *Misiones secretas* (dinner): each phone gets 4 secret missions (10/20/20/30 pts). Tap **¡Lista!**, pick a witness; points only count once the witness confirms on their phone.
   4. *Cuenta la historia* (dessert): each phone starts a different story; each person adds one sentence (60 chars) seeing only the previous one, and stories rotate until every story has one sentence from everyone. Then each story is shown (also on the main screen), everyone votes for the funniest sentence (not their own), authors get 10 pts per vote.
4. **Terminar juego** shows the podium and a points-per-mode table.

The live leaderboard is the strip at the top of every phone (tap it to expand).

The Family Feud questions and answers live in `public/es.js` (`preguntas`). The points are approximate, inspired by popular Thanksgiving survey results; they are **not** from an official poll. Edit or add questions there: `['question', [['Answer', points, ['other ways to say it']], ...]]`.

## Notes

- State is kept in memory and saved to `state.json`. A refresh or reconnect restores the player (id stored in `localStorage`). If the server restarts it picks up where it left off.
- Duplicate names: rejected while that person is connected. If they dropped, typing the same name reclaims their seat.
- If someone's phone dies during the story round, the host taps **Avanzar sin esperar** and their missing sentence is skipped.
- Max 12 players. No accounts or passwords; this is meant for a living room, not the open internet.

## Test (8 simulated clients)

```bash
npm test
```

Starts a real server on port 3199 and plays a whole game with 8 WebSocket clients (join with teams, duplicate/empty answers, Family Feud turns/strikes/steal/host credit/double rounds, main screen, missions with witness, disconnect/reconnect, server restart, story rounds, votes, winner screen).
