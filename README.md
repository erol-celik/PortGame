# Port Simulation

A browser-based 2D port/container-yard driving simulation built with vanilla HTML5 Canvas and JavaScript. The player operates a vehicle inside a simulated container terminal, picking up and delivering containers while following safety rules (speed limits, horn usage near workers) under a shift timer and efficiency scoring system.

## Features

- Top-down 2D world rendered on HTML5 Canvas (zones, buildings, ship, parked trucks, pedestrians, cones, seagulls)
- Task system: pick up an assigned container and deliver it to the drop zone
- Safety rules tracking: speed limit compliance and horn usage near workers, with a live violation counter
- Efficiency score and shift clock UI overlay
- Mini-map (TOS-style) panel
- Vehicle status panel (speed, load, fuel)
- Horn and reverse-alarm audio feedback

## Tech Stack

- Plain HTML5, CSS3, and JavaScript (no frameworks, no build step, no external dependencies)
- Runs entirely in the browser via the Canvas 2D API

## Project Structure

```
index.html      Page shell and UI overlay markup
style.css       Styling for the UI overlay and canvas layout
game.js         Game logic, rendering, and simulation loop
sources/        Image and audio assets (sprites, sound effects)
```

## Getting Started

No build tools or package manager are required. To run the game locally, serve the project folder with any static file server (opening `index.html` directly via `file://` may block asset loading in some browsers due to CORS restrictions).

Using Node.js (if installed):

```bash
npx serve .
```

Or using Python:

```bash
python -m http.server 8000
```

Then open the printed local URL (e.g. `http://localhost:8000`) in your browser.

## Usage / Controls

- `W` / `A` / `S` / `D` — drive the vehicle
- Interact key (see in-game panel) — pick up / drop off a container
- Horn key — sound the horn (required near workers for safety compliance)
- Double-tap space — restart the shift

Complete the operation order (pick up and deliver the assigned container) before the shift clock runs out while maintaining a clean safety record to maximize your efficiency score.

## Known Issues

- `game.js` references a `background.png` background image (with a fallback to `sources/background.png`) that is not currently present in the repository. Add the missing asset or update the reference before relying on the background image.

## License

No license file is currently included in this repository. All rights are reserved by the author unless a license is added. If you intend to share or open-source this project, add a `LICENSE` file (e.g. MIT, Apache-2.0) specifying the terms under which others may use, modify, and distribute the code.
