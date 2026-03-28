# Roadmap

Ideas and planned features, roughly ordered by scope.

## Play Mode

- [x] Play ▶ button on each song card for non-interactive preview
- [x] Waterfall scrolls, keyboard lights up, audio plays via Web Audio API
- [x] Simplified controls bar (no scoring, no mode toggle)
- [x] Auto-returns to song list after playback finishes

## Improve Modes

- [x] Countdown or wait-for-first-keypress before playback starts (performance mode)
- [x] Restart should preserve speed config
- [x] Define naming: renamed to "Practice" / "Performance"
- [x] Mode + config (speed, start behavior) stored globally per session

## Progression Tracking

- [x] Separate best score and stars per mode (Practice / Performance)
- [x] Backward-compatible migration from old flat format
- [x] Song cards show per-mode star rows (P / F)
- [x] Recommendation logic considers both modes

## Review Metrics

Better feedback on how well the player performed.

- [x] Timing accuracy — measure how precisely the player hits note start/end times
- [x] Visualize timing on keys (accuracy-based color: green/yellow/orange-red)
- [x] Waterfall timing markers showing press/release offset
- [x] Accuracy % on completion screen
- [x] Persist best accuracy per mode in progress

## Song Discovery

- [ ] Search for and download song sheets from external sources
