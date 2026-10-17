// html-validate configuration (WP10 R1). CI runs:
//   npx html-validate index.html manual.html relay/map.html tools/latency-clock.html
// html-validate is installed in CI only (never a repository dependency: no build step, no node_modules).
//
// Every rule of "html-validate:recommended" is an error, except the accepted rules below. Each one is downgraded to a
// warning (still printed, never failing) with the reason it is accepted. Do not add a rule here to make a new page
// pass: fix the markup instead, or document a reason as specific as these.
//
// Not validated: archive/VTOL_Relay_Carrier_Operating_Manual.html (obsolete, marked OBSOLETE and noindex, kept only
// as a record; plan REP-06).
module.exports = {
  extends: ['html-validate:recommended'],
  rules: {
    // Small layout tweaks (gap, margin, flex, min-width) written inline in the existing markup style of index.html
    // (95), relay/map.html (39) and tools/latency-clock.html (2). Colours never come from these: they use CSS
    // variables, and scripts/check-colours.mjs fails on a hex colour in an inline style. manual.html has none.
    'no-inline-style': 'warn',

    // index.html (31 buttons): none of them is inside a <form>, so the implicit type="submit" has no effect.
    // New buttons should still carry type="button" (manual.html and relay/map.html have no such warning).
    'no-implicit-button-type': 'warn',

    // index.html: the battery flight-log table (#bl-log-table) has its header row directly under <table>, and the page
    // script appends the log rows; browsers insert the <tbody> themselves, so the rendered table is identical.
    'prefer-tbody': 'warn',

    // relay/map.html: the "Alt (m REL)" <label> wraps the three altitude-mode buttons (Rel / AGL / AMSL) of one
    // control group (WP02). The buttons carry their own text and titles; splitting the label would change the
    // established map UI for no user benefit.
    'multiple-labeled-controls': 'warn'
  }
};
