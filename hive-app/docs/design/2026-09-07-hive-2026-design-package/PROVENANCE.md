# Provenance — HIVE 2026 design package as received

Received 2026-09-07 from Kody as `HIVE2026ClaudePackage_2.zip` (with the
direction PDF alongside), reviewed source `ca961818b68321791ab8b8de4b0bd345bb428999`.
Every file in the archive, with its SHA-256 as received:

| File                                                  | SHA-256                                                            | Kept here |
| ----------------------------------------------------- | ------------------------------------------------------------------ | --------- |
| `Claude-Start-Here.md`                                | `2018733f7c6a1051027473ab8f5a19ed09494a2899f2f732fe952163c49dc734` | yes       |
| `HIVE-2026-Design-Direction.pdf`                      | `0718a78e5f98537ed80443db74a2d85e617a5c069e10a72f99bbaab219500883` | yes       |
| `HIVE-2026-Preview.png`                               | `5e8d66138ba753688d869a303d59ba0fbe321e1e11f2072541edf3fdb471b400` | yes       |
| `Implementation-Map.md`                               | `f80935d4b7a22892e8f2c89b4cf86a076ee0f11f24eb4e712a6e045d0e5412d8` | yes       |
| `README.md`                                           | `8de950b2c6d6574d4d9d95fb6ce3447b860862b61630dacf7f3ee3b643b39b6b` | yes       |
| `asset-manifest.json`                                 | `c9ce44d3ef7fac023ec76bd9c1f1e9338cf987ae090c19b8f47d04563864996f` | yes       |
| `tokens.reference.ts`                                 | `2a511f7031875c8740102afc230e99401861d3a501e49aed7b92ae62352dacdd` | as `.txt` |
| `validation.md`                                       | `1d30b3caebfe0a950fb75c3b483c75ed716a42abc528fc540818373dadd0b263` | yes       |
| `assets/Font-Source-Notice.txt`                       | `009a473867dc7daf8d17bf4eaf066bfd1a21b97a3a345e47cb5788745cfab448` | `assets/fonts/` |
| `assets/OFL.txt`                                      | `515d5a69bd24e78143d2f6217dbfcc08d6667718062bd183cb4fe19189208c93` | `assets/fonts/` |
| `assets/Manrope-400.ttf`                              | `9291aa3225f4beb6213dcdc0a2844fb5aa9f5ec2a652dd0add3bf083ff1b6a8b` | `assets/fonts/` |
| `assets/Manrope-500.ttf`                              | `2ed0d3b7b076255e56e83d17e911b6df0ad3c16566d3b69233c608a6872d44df` | `assets/fonts/` |
| `assets/Manrope-600.ttf`                              | `0249199ce73afe6bc8f0e09bed2818bf69cbb59ad310a1522f0f3079c4fdf1a4` | `assets/fonts/` |
| `assets/Manrope-700.ttf`                              | `40efcf38578a26d522c892cb54a030fdf11b07edb086052b787244c9806c6607` | `assets/fonts/` |
| `assets/Manrope-800.ttf`                              | `b2b455c6aa22816e69b9b143475d7b4a47c1fed74781a7d2e3e2ab4e7d73ee34` | `assets/fonts/` |
| `assets/hive-mark-primary-512.png`                    | `b1f236abebcbbb1ba0f041d0f48a0e226cdc040cba358535239b03d2110f4906` | `assets/brand/` |
| `assets/HIVE-Mark-Transparent-2048.png`               | `3b50f64b697e21099fa2ee34741fab2a82b1c5846501f7022b709f264d45e272` | `assets-received/` |
| `assets/hive-mark-primary.svg`                        | `b54b2be745b88b8555898ded56f7c3717f611a6a664fe2ef42b8c40b0e1dd5e0` | no (1)    |
| `assets/hive-mark-soft-black.svg`                     | `50de3081619f983e84410ea4572a9c030535b413c1619395e43d13792a8ad6be` | no (1)    |
| `assets/manrope-latin-variable.woff2`                 | `e310b55a7fd9677f5e3555e6c6c4d064fa1f1d24393f0ddbe217cea12a8c432f` | no (2)    |
| `build_design.py`                                     | `bdad5b9c69dfc0fc85621ea368f72e377a31267ee9cca3b03ef61590e48c9eec` | no (3)    |
| `source/Honeybee_Accounting_Brand_Kit_v3.0_2026-08-21.pdf` | `d726485e36d16f8c11e7dfe7da6e7faf297a87efa4594532347caccb2f9abd81` | yes  |
| `source/hive-portal-branding-standard.md`             | `8fe3ee1a0ddf6026715c532125afc79db851ce45cca030e1b3bd2c1cdfd3c297` | yes       |
| `source/hive-product-mark-opaque-reference.png`       | `11e412cfd7ac203c8b1d6454c9c95326f3a8d205a55db01f6bbac98dfa39a282` | yes       |

Notes:

1. The two SVG derivatives are not tracked: the audit gate's image policy
   admits PNG build images only (`scripts/audit-gate.mjs`, positive
   allowlist), and the app renders the PNG mark. Their hashes are recorded
   here so they can be re-supplied byte-exactly when a vector master is
   needed for store icons.
2. The variable WOFF2 is the web font; the native app bundles the five
   static TTF instances generated from it.
3. `build_design.py` is the generator of the direction PDF (reportlab); the
   PDF itself is the reviewed artifact and is kept.

Everything kept under this directory is byte-identical to the archive and
is excluded from formatting (`.prettierignore`). The app's copies of the
fonts and the mark are held to the manifest by
`tests/scripts/brand-assets.test.mjs`.
