# Theme Accessibility and Light Theme

Date: 2026-09-24

## Goal

Improve Forge Studio text readability in the existing dark theme and add a persistent light theme without changing scene rendering semantics.

The theme system applies to editor chrome:

- top bar and workspace tabs,
- toolbars and menus,
- Timeline,
- Graph Editor and Bezier Handle Inspector,
- sidebars and property panels,
- status bar,
- dialogs and toasts.

The WebGL scene background remains an editor/scene display setting and is not replaced by the UI theme.

## Theme model

Forge supports two UI themes:

- dark — default
- light

The active theme is stored in:

`localStorage["forge-theme"]`

The root document exposes:

`<html data-theme="dark|light">`

The theme toggle lives in the top bar and shows the theme that will be activated next:

- Light while Dark is active
- Dark while Light is active

The toggle also exposes an updated accessible label and `aria-pressed` state.

## Theme tokens

Core UI colors are defined through CSS custom properties for:

- app background,
- panel / raised / soft surfaces,
- input surface,
- primary / secondary / muted / faint text,
- standard and strong borders,
- hover states,
- graph background and grid.

Light theme overrides these tokens at the document root instead of duplicating every component rule.

Component-specific colors remain for semantic states such as:

- animation accent / selected keys,
- Free / Aligned / Auto handle modes,
- transform axis colors,
- ready / performance indicators.

## Dark-theme readability

The previous dark theme used several 7–9 px gray-blue labels with insufficient contrast against editor surfaces.

The upgraded dark theme raises contrast for, among others:

- Graph detail text,
- Graph channel labels and mode abbreviations,
- Key Inspector / Handle Inspector secondary text,
- Timeline Summary Keys hints,
- Timeline ruler labels,
- status bar scene statistics and navigation text.

Disabled controls remain intentionally dimmed; ordinary secondary information should not look disabled.

## Light theme

Light theme provides dedicated surfaces, borders, text colors, key/curve colors, handle colors, dialog colors and selection states.

It is not implemented as CSS inversion.

Animation semantics remain visually distinct:

- authored keys and curves use a darker warm accent,
- selected keys remain stronger than unselected keys,
- Free / Aligned / Auto handles retain separate treatments,
- Graph grid lines remain visible without dominating the curve.

## Accessibility regression

Playwright coverage checks:

1. Dark is the default when no saved preference exists.
2. Theme toggle switches to Light and back to Dark.
3. The selected theme survives page reload.
4. Graph detail text, Graph channel mode text, Timeline Summary Keys hints and scene statistics meet at least a 4.5:1 computed contrast ratio in both themes.
5. Major Light-theme editor surfaces are actually light instead of leaving mixed dark panels behind.

## Non-goals

- no automatic OS `prefers-color-scheme` selection in this package,
- no per-project theme setting,
- no scene-lighting or material changes,
- no replacement of the user-selectable viewport background,
- no high-contrast third theme yet.

Full Windows-local build and Playwright validation remain the merge gate for the exact PR HEAD.
