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

Track a second success level per mode — e.g. separate completion state for wait-mode vs free-play.

## Review Metrics

Better feedback on how well the player performed.

- [ ] Timing accuracy — measure how precisely the player hits note start/end times
- [ ] Visualize timing on keys (e.g. a sliding indicator showing early/late/on-time)

## Song Discovery

- [ ] Search for and download song sheets from external sources
