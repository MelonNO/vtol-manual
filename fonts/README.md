# Self-hosted fonts (WP09 R1, plan SW-01)

The pages load these files through `@font-face` in `css/base.css`. No page loads Google Fonts any more, so the fonts work offline and the CSPs allow `font-src 'self'` only.

| File | Family | Weights | Unicode subset | Source (downloaded 2026-10-17) | SHA-256 |
|---|---|---|---|---|---|
| `oswald-latin.woff2` | Oswald (variable `wght` axis) | 400, 600, 700 (one variable file covers all three) | latin | `https://fonts.gstatic.com/s/oswald/v57/TK3IWkUHHAIjg75cFRf3bXL8LICs1_Fv40pKlN4NNSeSASz7FmlWHYg.woff2` | `571f3457dab507b6f2ce5394d593ca015251b69fea81ab7a546bd2368e9fc3ed` |
| `oswald-latin-ext.woff2` | Oswald (variable `wght` axis) | 400, 600, 700 | latin-ext | `https://fonts.gstatic.com/s/oswald/v57/TK3IWkUHHAIjg75cFRf3bXL8LICs1_Fv40pKlN4NNSeSASz7FmlYHYjedg.woff2` | `99016932b273efa7d55b3a0ae9fe4babc6dbdcd7539f58a742697054f89b1142` |
| `share-tech-mono-latin.woff2` | Share Tech Mono | 400 | latin (the only subset Google serves) | `https://fonts.gstatic.com/s/sharetechmono/v16/J7aHnp1uDWRBEqV98dVQztYldFcLowEF.woff2` | `41e6b9f297f7d9a2df2aaa274092f76d2f72711a15ca455f7f4f4f92caf16b72` |

- The `.woff2` URLs are the ones the Google Fonts CSS API returned for
  `https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&display=swap` and
  `https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap` (the same request the pages used before), with a current Chrome user agent.
  The files are unmodified. The `unicode-range` values in `css/base.css` are copied from that CSS.
- Google serves Oswald as one variable font per subset: the 400, 600 and 700 `@font-face` rules all point to the same file. `css/base.css` declares it once with `font-weight: 200 700`.
- Cyrillic and Vietnamese subsets are not included. The pages are English/Norwegian; Norwegian letters (æ ø å) are in the latin subset.

## Licences

Both families are licensed under the SIL Open Font License 1.1. The licence files come from the google/fonts repository:

- `OFL-Oswald.txt` — `https://raw.githubusercontent.com/google/fonts/main/ofl/oswald/OFL.txt` (Copyright 2016 The Oswald Project Authors)
- `OFL-ShareTechMono.txt` — `https://raw.githubusercontent.com/google/fonts/main/ofl/sharetechmono/OFL.txt` (Copyright 2012 Carrois Type Design, Reserved Font Name "Share")

The licence files are not precached by the service worker (they are not needed at run time).
