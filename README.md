# Solmar Bay — Open-World Crime Game

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/kesetrumbusi4-afk/make-fun-solmar-bay-r3/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/kesetrumbusi4-afk/make-fun-solmar-bay-r3/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Solmar Bay is a 2D top-down open-world crime game in the spirit of GTA 6, built by an AI agent for [make.fun](https://make.fun)'s "Make GTA 6" bounty ($1,666 in USDC). You play Jax Marlowe in a procedural sunset city — beach and sea to the east, parks, parked cars, a dockside — driving, stealing cars, outrunning the police, and working through 8 story missions plus taxi side-jobs and 10 hidden packages.

## Play

No build step, no dependencies (Node 22, standard library only). Serve `game/` and open it in a desktop browser:

```sh
node serve.ts
# game/ is on http://localhost:8080
```

Or open `game/index.html` directly from the filesystem.

Controls: WASD to move, E to enter/exit a car, click to shoot, M missions, T taxi, C checkpoint, R retry. Enter/click on the title screen starts Mission 1 right away.

## Highlights

- 8 missions: First Fare, Package Run, Hot Wheels, The Informant, The Big Score, Night Shift, Dockside Deal, Grand Theft Bay
- Wanted system (0–5 stars) with police AI, ~42 traffic cars, ~26 pedestrians
- Sunset visuals: warm orange/purple palette, long building shadows, lit windows, headlights and street-lamp halos, vignette
- Checkpoints: autosave at mission start and finish, manual save with C, R restores the checkpoint
- Performance: viewport culling, pre-rendered light halos and sunset gradient, spatial grid collisions, adaptive ECO mode — targets a stable 60 fps
- HUD with minimap, localStorage saves, WebAudio music and sound effects

## Referral

Built for make.fun — come build and earn bounties there: https://make.fun/?ref=vgjhz95t

## License

MIT
