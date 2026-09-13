# GRADITOR

```text
   ____  ____  ___    ____  __________________  ____
  / ___// __ \/   |  / __ \/  _/_  __/ __  / / __ \
 / / __/ /_/ / /| | / / / // /  / / / / / / / /_/ /
/ /_/ / _, _/ ___ |/ /_/ // /  / / / /_/ / / _, _/
\____/_/ |_/_/  |_/_____/___/ /_/  \____/ /_/ |_|

            PLANETARY DEFENSE RUN
```

A momentum-driven lunar combat game. Pilot a fragile lander through hostile terrain, destroy every defense turret, and touch down on the extraction pad before fuel or hull integrity runs out.

**Play live:** [finickyserenity.github.io/graditor](https://finickyserenity.github.io/graditor/)

## Mission

1. Launch from the starting pad.
2. Destroy every hostile turret. Gunfire and direct ramming both work, though collisions damage your hull.
3. Land gently on the extraction pad to secure the sector.
4. Stay inside the protected flight zone. Radiation exposure outside the map eventually damages the hull.

Higher sectors add stronger defenses and tighter terrain. Difficulty and flight physics can be adjusted from the gear menu.

## Controls

### Desktop

| Action | Keys |
| --- | --- |
| Rotate left | `A` or `Left Arrow` |
| Rotate right | `D` or `Right Arrow` |
| Thrust | `W` or `Up Arrow` |
| Fire | `Space` |

### Mobile

- Drag the left joystick horizontally to rotate.
- Hold the large lower-right button to thrust.
- Tap or hold the smaller upper-right button to fire.
- Double-tap the center of the play area to pause.

For the best iPhone experience, rotate to landscape, choose **Share > Add to Home Screen** in Safari, then launch Graditor from its Home Screen icon. When a new version is available, use the in-game **Update Ready > Reload** prompt.

## Flight Notes

- Landing speed and angle matter. Hard impacts damage the hull.
- The HUD tracks fuel, hull, speed, altitude, and remaining hostiles.
- Leaving the protected map triggers a radiation warning and a short recovery window.
- Scores and callsigns are stored locally in the browser.
- Settings pause an active flight while the dialog is open.

## Run Locally

Graditor is dependency-free, but its PWA features require an HTTP server:

```sh
python3 -m http.server 4173
```

Open [http://localhost:4173](http://localhost:4173). Production hosting should use HTTPS so installation, offline caching, and updates work correctly.

## Project Files

- `index.html` - game interface and dialogs
- `graditor.css` - responsive presentation and mobile controls
- `graditor.js` - physics, rendering, gameplay, audio, and persistence
- `manifest.webmanifest` - installable app metadata
- `service-worker.js` - offline cache and update lifecycle
