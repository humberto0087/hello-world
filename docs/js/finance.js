// Loan sizing / underwriting helpers used by the deal analyzer.
// All percentages are whole numbers (10 = 10%). These are estimates for
// conversations with buyers, not a loan commitment.

export function amortizedPayment(principal, annualRatePct, years) {
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (principal <= 0) return 0;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - (1 + r) ** -n);
}

/** Fix & flip / bridge loan: lender funds a % of purchase + % of rehab, capped by % of ARV. */
export function fixAndFlip({
  purchase = 0, rehab = 0, arv = 0,
  purchaseLtcPct = 90, rehabFundedPct = 100, maxArvPct = 75,
  ratePct = 10.5, pointsPct = 2, months = 8,
  buyClosingPct = 2, sellCostPct = 6, holdingMonthly = 0,
}) {
  const requested = purchase * (purchaseLtcPct / 100) + rehab * (rehabFundedPct / 100);
  const arvCap = arv * (maxArvPct / 100);
  const loan = Math.max(0, Math.min(requested, arvCap || requested));
  const points = loan * (pointsPct / 100);
  // Interest-only; rehab funds are drawn over time, assume ~half outstanding on average.
  const rehabPortion = Math.min(loan, rehab * (rehabFundedPct / 100));
  const avgBalance = loan - rehabPortion / 2;
  const interest = avgBalance * (ratePct / 100) * (months / 12);
  const buyClosing = purchase * (buyClosingPct / 100);
  const sellCosts = arv * (sellCostPct / 100);
  const holding = holdingMonthly * months;
  const totalCost = purchase + rehab + buyClosing + points + interest + sellCosts + holding;
  const cashNeeded = purchase + rehab + buyClosing + points - loan;
  const profit = arv - totalCost;
  return {
    loan, arvCap, requested, limitedByArv: arvCap > 0 && requested > arvCap,
    points, interest, monthlyInterest: loan * (ratePct / 100) / 12,
    buyClosing, sellCosts, holding, totalCost, cashNeeded, profit,
    roiPct: cashNeeded > 0 ? (profit / cashNeeded) * 100 : null,
    ltcPct: purchase + rehab > 0 ? (loan / (purchase + rehab)) * 100 : null,
    ltvArvPct: arv > 0 ? (loan / arv) * 100 : null,
    // Classic 70% rule max offer
    maxOffer70: arv * 0.7 - rehab,
  };
}

/** Ground-up construction loan. */
export function construction({
  land = 0, hard = 0, soft = 0, completedValue = 0,
  ltcPct = 80, maxLtvPct = 70, ratePct = 11, pointsPct = 2, months = 14, avgDrawPct = 55,
}) {
  const totalCost = land + hard + soft;
  const byLtc = totalCost * (ltcPct / 100);
  const byLtv = completedValue * (maxLtvPct / 100);
  const loan = Math.max(0, completedValue ? Math.min(byLtc, byLtv) : byLtc);
  const points = loan * (pointsPct / 100);
  const interestReserve = loan * (avgDrawPct / 100) * (ratePct / 100) * (months / 12);
  const equity = totalCost + points + interestReserve - loan;
  const profit = completedValue ? completedValue - totalCost - points - interestReserve : null;
  return {
    totalCost, loan, byLtc, byLtv, limitedByLtv: !!completedValue && byLtv < byLtc,
    points, interestReserve, equity, profit,
    marginPct: profit !== null && totalCost ? (profit / totalCost) * 100 : null,
    ltcPct: totalCost ? (loan / totalCost) * 100 : null,
    ltvPct: completedValue ? (loan / completedValue) * 100 : null,
  };
}

/** DSCR / rental loan for multifamily or 1-4 unit rentals. */
export function dscr({
  price = 0, downPct = 25, ratePct = 7.25, amortYears = 30,
  monthlyRent = 0, otherIncome = 0, vacancyPct = 5,
  taxRatePct = 1.2, insuranceAnnual = 0, hoaMonthly = 0, mgmtPct = 6, repairsPct = 5, utilitiesMonthly = 0,
}) {
  const loan = price * (1 - downPct / 100);
  const pi = amortizedPayment(loan, ratePct, amortYears);
  const gross = (monthlyRent + otherIncome) * 12;
  const egi = gross * (1 - vacancyPct / 100);
  const taxes = price * (taxRatePct / 100);
  const opex = taxes + insuranceAnnual + hoaMonthly * 12 + egi * (mgmtPct / 100) + egi * (repairsPct / 100) + utilitiesMonthly * 12;
  const noi = egi - opex;
  const debtService = pi * 12;
  // Most DSCR lenders size on PITIA: gross rent / (P&I + taxes + insurance + HOA).
  const pitia = pi + taxes / 12 + insuranceAnnual / 12 + hoaMonthly;
  return {
    loan, downPayment: price - loan, monthlyPI: pi, pitia,
    gross, egi, opex, noi, debtService,
    capRatePct: price ? (noi / price) * 100 : null,
    dscrNoi: debtService ? noi / debtService : null,
    dscrRent: pitia ? (monthlyRent + otherIncome) / pitia : null,
    cashFlowMonthly: (noi - debtService) / 12,
    cashOnCashPct: price - loan > 0 ? ((noi - debtService) / (price - loan)) * 100 : null,
    // Max loan at 1.25x NOI coverage
    maxLoanAt125: (() => {
      const maxPmt = noi / 1.25 / 12;
      const r = ratePct / 100 / 12; const n = amortYears * 12;
      return r ? (maxPmt * (1 - (1 + r) ** -n)) / r : maxPmt * n;
    })(),
  };
}
