# Generated images

Rasterized from the SVGs in `../gallery/` and `../`. **Do not edit these by hand** — change the
generator or the SVG and re-render.

```sh
node tools/gen-gallery.mjs          # regenerate the gallery SVGs (measures text to fit)
for f in assets/gallery/*.svg; do
  rsvg-convert -w 1270 -h 760 "$f" -o "assets/png/$(basename "$f" .svg).png"
done
rsvg-convert -w 1200 -h 630 assets/og-card.svg -o assets/png/og-card-1200x630.png
rsvg-convert -w 240 -h 240 assets/mark.svg -o assets/png/thumbnail-240.png
```

Needs `librsvg2-bin` and `fonts-dejavu-core`. `rsvg-convert` resolves generic `monospace` to
DejaVu Sans Mono, which is wider than the JetBrains Mono these were designed against — that is
why `gen-gallery.mjs` measures every line and fails rather than emitting a card that clips.

| File | Size | Use |
|---|---|---|
| `1-silent-failures.png` | 1270x760 | Product Hunt gallery 1 - the story |
| `4-grade-share.png` | 1270x760 | 2 - the grade and share card |
| `2-security.png` | 1270x760 | 3 - depth of the security rules |
| `3-policy-ci.png` | 1270x760 | 4 - team policy and CI |
| `5-og-card.png` | 1270x667 | 5 - the closer |
| `og-card-1200x630.png` | 1200x630 | social / og:image |
| `thumbnail-240.png` | 240x240 | Product Hunt thumbnail |
| `icon-512.png` | 512x512 | any listing needing a larger icon |
