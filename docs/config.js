// Branding + defaults for the deal desk. Edit these, commit, and the site updates.
window.DEAL_DESK_CONFIG = {
  companyName: 'San Diego Deal Desk',
  agentName: 'Your Name',
  licenseLine: 'DRE #00000000 · NMLS #000000', // shown in footer and in emails sent to buyers
  email: '',            // reply-to used in the "email buyer" button signature
  phone: '',
  // Default loan assumptions used to pre-fill the analyzer (whole-number percents).
  loanDefaults: {
    fixFlip: { purchaseLtcPct: 90, rehabFundedPct: 100, maxArvPct: 75, ratePct: 10.5, pointsPct: 2, months: 8 },
    construction: { ltcPct: 80, maxLtvPct: 70, ratePct: 11, pointsPct: 2, months: 14 },
    dscr: { downPct: 25, ratePct: 7.25, amortYears: 30, vacancyPct: 5, taxRatePct: 1.2 },
  },
};
