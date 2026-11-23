# Mini Me art

Source for Mini Me's three hand-drawn art styles. Nothing here ships with the
app: the app reads the generated JSON in `lib/companion/art/`.

| Key | Art style id | Size  | JSON                                  |
| --- | ------------ | ----- | ------------------------------------- |
| A   | `detailed`   | 48 px | `lib/companion/art/detailed.json`     |
| B   | `chibi`      | 32 px | `lib/companion/art/chibi.json`        |
| C   | `chibiLarge` | 48 px | `lib/companion/art/chibiLarge.json`   |

- `art/directionX.mjs`: the idle art (body, hair styles, beard, glasses) as slot-code grids.
- `build/poses.mjs`: per-style pose and face edits for every animation state.
- `build/anim.mjs`: applies the poses and writes `art/animX.mjs` (plain final grids, git-ignored).
- `to-json.mjs`: converts `art/animX.mjs` to the app's JSON.
- `art/palette.mjs`, `art/anim_render.mjs`: the reference palette and compositor. The app's
  `lib/companion/palette.ts` and `lib/companion/sprite.ts` are ports of these; keep them in step
  (`sprite.test.ts` checks the app renders the same pixels via frame hashes).
- The other files in `build/` are the artist's authoring helpers (grid DSL, curl texture, review strips).

## Regenerate the JSON

From `apps/desktop`:

```sh
node scripts/mini-me-art/build/anim.mjs        # all styles, or pass A, B or C
node scripts/mini-me-art/to-json.mjs
```

Then run `npx vitest run lib/companion` — if the art changed on purpose, update the hashes in
`sprite.test.ts` from `art/anim_render.mjs`'s `composeFrame`.

## Review renders

`node scripts/mini-me-art/art/anim_render.mjs [A|B|C]` writes `anim_sheet_X.png` and
`anim_preview_X.gif` next to it (git-ignored).
