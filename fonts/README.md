# Self-hosted fonts (WP09 R1, plan SW-01; IBM Plex Sans added by WP23)

The pages load these files through `@font-face` in `css/base.css`. No page loads Google Fonts any more, so the fonts work offline and the CSPs allow `font-src 'self'` only.

| File | Family | Weights | Unicode subset | Source (downloaded 2026-10-17) | SHA-256 |
|---|---|---|---|---|---|
| `oswald-latin.woff2` | Oswald (variable `wght` axis) | 400, 600, 700 (one variable file covers all three) | latin | `https://fonts.gstatic.com/s/oswald/v57/TK3IWkUHHAIjg75cFRf3bXL8LICs1_Fv40pKlN4NNSeSASz7FmlWHYg.woff2` | `571f3457dab507b6f2ce5394d593ca015251b69fea81ab7a546bd2368e9fc3ed` |
| `oswald-latin-ext.woff2` | Oswald (variable `wght` axis) | 400, 600, 700 | latin-ext | `https://fonts.gstatic.com/s/oswald/v57/TK3IWkUHHAIjg75cFRf3bXL8LICs1_Fv40pKlN4NNSeSASz7FmlYHYjedg.woff2` | `99016932b273efa7d55b3a0ae9fe4babc6dbdcd7539f58a742697054f89b1142` |
| `share-tech-mono-latin.woff2` | Share Tech Mono | 400 | latin (the only subset Google serves) | `https://fonts.gstatic.com/s/sharetechmono/v16/J7aHnp1uDWRBEqV98dVQztYldFcLowEF.woff2` | `41e6b9f297f7d9a2df2aaa274092f76d2f72711a15ca455f7f4f4f92caf16b72` |
| `ibm-plex-sans-latin.woff2` | IBM Plex Sans (variable `wght` axis, v23) | 400, 600 (one variable file covers 100–700) | latin | `https://fonts.gstatic.com/s/ibmplexsans/v23/zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxeKYY.woff2` (downloaded 2026-10-18) | `e2291e842cf5af167122a22881a740c7f2dda7716f1e8cd76680264f4a859470` |
| `ibm-plex-sans-latin-ext.woff2` | IBM Plex Sans (variable `wght` axis, v23) | 400, 600 | latin-ext | `https://fonts.gstatic.com/s/ibmplexsans/v23/zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxQKYbABA.woff2` (downloaded 2026-10-18) | `d160e20920ae4d6556518d352d3af27a74e9b0de3d8fe17b1c1044fc75aa2f81` |

- The `.woff2` URLs are the ones the Google Fonts CSS API returned for
  `https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&display=swap` and
  `https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap` (the same request the pages used before), with a current Chrome user agent.
  The files are unmodified. The `unicode-range` values in `css/base.css` are copied from that CSS.
- Google serves Oswald as one variable font per subset: the 400, 600 and 700 `@font-face` rules all point to the same file. `css/base.css` declares it once with `font-weight: 200 700`.
- **IBM Plex Sans** (body text, WP23): the URLs are the ones the Google Fonts CSS API returned on 2026-10-18 for
  `https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&display=swap` (Chrome user agent). Google serves
  it as one variable font per subset (the 400 and 600 rules point at the same file; the request for `wght@100..700`
  returns the same URLs with `font-weight: 100 700`), so `css/base.css` declares each subset once with
  `font-weight: 100 700`. Font version in the URL: `v23`. The files are unmodified (checked: WOFF2 magic `wOF2`,
  45 712 and 30 964 bytes) and the `unicode-range` values are copied from that CSS. Why Plex: an OFL sans with a
  technical character that sits well next to Oswald and Share Tech Mono, clear distinctions between `0 O`, `1 l I`,
  and tabular figures.
- Cyrillic and Vietnamese subsets are not included. The pages are English/Norwegian; Norwegian letters (æ ø å) are in the latin subset.

## Licences

All three families are licensed under the SIL Open Font License 1.1. The licence files come from the google/fonts repository:

- `OFL-Oswald.txt` — `https://raw.githubusercontent.com/google/fonts/main/ofl/oswald/OFL.txt` (Copyright 2016 The Oswald Project Authors)
- `OFL-ShareTechMono.txt` — `https://raw.githubusercontent.com/google/fonts/main/ofl/sharetechmono/OFL.txt` (Copyright 2012 Carrois Type Design, Reserved Font Name "Share")
- `OFL-IBMPlexSans.txt` — `https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexsans/OFL.txt` (Copyright © 2017 IBM Corp., Reserved Font Name "Plex"; downloaded 2026-10-18 with CRLF, stored with LF)

The licence texts are unmodified; the repository stores them with LF line endings (`.gitattributes`; the Oswald file was downloaded with CRLF). They are not precached by the service worker (not needed at run time).
