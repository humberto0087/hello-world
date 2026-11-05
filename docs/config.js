// Branding, contact info and defaults. Edit these, commit, and both the client site
// (index.html) and the internal deal desk (desk.html) update.
window.DEAL_DESK_CONFIG = {
  companyName: 'San Diego Real Estate Partners',
  tagline: 'Your one-stop shop to invest, build and grow equity in San Diego County.',
  agentName: 'Your Name',
  licenseLine: 'DRE #00000000 · NMLS #000000', // required on CA real estate and mortgage advertising
  email: '',            // where website inquiries go if no intakeEndpoint is set
  phone: '',
  // Optional: a scheduling link (Calendly, Google Calendar booking page, etc.)
  calendarUrl: '',
  // Optional: a form backend (e.g. Formspree/Basin/Getform URL) that accepts a JSON POST.
  // Without one, the intake form opens the visitor's email app addressed to `email`.
  intakeEndpoint: '',
  serviceArea: 'San Diego County',
  // Default loan assumptions used to pre-fill the analyzers (whole-number percents).
  loanDefaults: {
    fixFlip: { purchaseLtcPct: 90, rehabFundedPct: 100, maxArvPct: 75, ratePct: 10.5, pointsPct: 2, months: 8 },
    construction: { ltcPct: 80, maxLtvPct: 70, ratePct: 11, pointsPct: 2, months: 14 },
    dscr: { downPct: 25, ratePct: 7.25, amortYears: 30, vacancyPct: 5, taxRatePct: 1.2 },
    build: { costPerSf: 425, softPct: 12, contingencyPct: 10, maxLtcPct: 80, maxLtvPct: 80, buildRatePct: 9, buildMonths: 12, permRatePct: 7 },
  },
};
