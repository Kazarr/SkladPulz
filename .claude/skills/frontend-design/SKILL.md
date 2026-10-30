---
name: frontend-design
description: Lessons for building customer-facing frontend design. Use when starting visual design work, translating a prototype to production, writing CSS or page copy, or touching responsive images and layout.
---

# Frontend design: lessons

## Before building

- Get one visual direction approved on a static mockup, with reference sites the customer likes, before building pages; cap revision rounds and stop at the cap. Why: design exploration was ~40% of a project's AI cost, one run went 40 h after the agent raised its own round cap, and the verdict on generic output was that it looked cheap. Source: pesitro retro 2026-10-21.
- Page copy states only facts from the ticket or the brief. Every claim about the brand, services or quality is the customer's to make. Source: pesitro#100.

## Design tokens

- All design values (colours, lengths, percentages, font weights, line heights, mix ratios) come from named tokens, enforced by a check that covers every value type. Why: the prose rule leaked raw values six times, each time in a type the check did not cover yet. Source: pesitro#33, #68, #96, #101, #131.
- A multiplier on a token (`calc(var(--x) * 1.5)`) is a raw value in disguise. Name it as a token unless it is a one-off mobile reduction. Source: pesitro#131.
- Keep ticket numbers out of CSS comments when a token check scans for `#` values. Source: pesitro#219.
- A token check skips the places where `var()` cannot stand (`@media` and `@container` conditions, `@keyframes` selectors) and every `:root` variant (`:root[data-theme=…]`, `:root:not(…)`), and tells ID selectors from hex colours. Why: a check that flags these turns red on the first dark theme or breakpoint, and someone then loosens it. Source: Servisnik#92.

## Layout and responsiveness

- Check layouts at widths between breakpoints and at 200% device pixel ratio, not only at the breakpoints. Why: fluid type wrapped a hero heading onto three lines at 1100–1250 px, and an oversized hero at 200% DPI was found by the customer. Source: pesitro#131, retro 2026-10-21.
- When an image's rendered width changes, update its `sizes` in the same change, derived from the same token, with an entry for every layout the CSS has. Source: pesitro#229, #230.
- Paginate a `scroll-snap` rail by the snap step (cards per page × card pitch), not by `clientWidth`. Source: pesitro#230.
- Anchor page-rhythm rules (`X ~ section`) to a section that always renders. Why: rhythm anchored to an optional section collapsed every gap when its data was empty. Source: pesitro#230.
- A link inside a styled heading or badge gets `color: inherit; text-decoration: none`, underlined only on `:hover`/`:focus-visible`, with a test of its resting colour. Why: the global link style turned dark headings blue and underlined, and only a screenshot noticed. Source: pesitro#228.

## Accessibility

- Information carried only by a background (dots, bars, swatches) needs `forced-colors: active` handling with a system colour, and a test under that emulation. Source: pesitro#131.

## Changing what exists

- When a change disables third-party CSS or JS, screenshot every page that used it and restore the missing rules in the same change. Source: pesitro#121.
- When a feature is deleted, delete its tokens, sprite symbols and CSS too. Source: pesitro#230.
- Run performance budgets (Lighthouse or equivalent) in the ticket tier for tickets that touch the frontend. Why: budgets checked only in CI failed 15–23 min after the push, twice. Source: pesitro#226, #229.
