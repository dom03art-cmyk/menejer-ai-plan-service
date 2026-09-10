// finance_calc.py-ийн Python логикийг шууд шилжүүлсэн JS хувилбар.
// НПВ, ДТОХ (IRR), эргэн төлөгдөх хугацаа, ашигт ажиллагааны хугарлын цэг (BEP), ROI, DSCR.

function npv(rate, cashFlows) {
  return cashFlows.reduce((sum, cf, i) => sum + cf / Math.pow(1 + rate, i), 0);
}

function irr(cashFlows, guess = 0.1, tol = 1e-6, maxIter = 1000) {
  let rate = guess;
  for (let iter = 0; iter < maxIter; iter++) {
    const npvVal = npv(rate, cashFlows);
    const dRate = 1e-6;
    const derivative = (npv(rate + dRate, cashFlows) - npvVal) / dRate;
    if (Math.abs(derivative) < 1e-12) break;
    const newRate = rate - npvVal / derivative;
    if (Math.abs(newRate - rate) < tol) return newRate;
    rate = newRate;
  }
  // Newton-Raphson олдохгүй бол bisection руу шилжинэ
  let lo = -0.99;
  let hi = 10.0;
  for (let i = 0; i < 1000; i++) {
    const mid = (lo + hi) / 2;
    const val = npv(mid, cashFlows);
    if (Math.abs(val) < 1e-3) return mid;
    if (val > 0) lo = mid;
    else hi = mid;
  }
  return rate;
}

function paybackPeriod(cashFlows) {
  let cumulative = cashFlows[0];
  if (cumulative >= 0) return 0.0;
  for (let i = 1; i < cashFlows.length; i++) {
    const prevCumulative = cumulative;
    cumulative += cashFlows[i];
    if (cumulative >= 0) {
      const fraction = cashFlows[i] !== 0 ? -prevCumulative / cashFlows[i] : 0;
      return Math.round(((i - 1) + fraction) * 100) / 100;
    }
  }
  return null; // Тухайн жилүүдэд нөхөгдөхгүй байна
}

function breakEvenPoint(fixedCosts, unitPrice, unitVariableCost) {
  const contributionMargin = unitPrice - unitVariableCost;
  if (contributionMargin <= 0) {
    return { error: "Нэгжийн үнэ хувьсах зардлаас бага тул BEP тооцох боломжгүй (гүйцээлтийн ашиг сөрөг/тэг)." };
  }
  const units = fixedCosts / contributionMargin;
  const revenue = units * unitPrice;
  return {
    units: Math.round(units * 10) / 10,
    revenue: Math.round(revenue),
    contribution_margin_per_unit: Math.round(contributionMargin * 100) / 100,
  };
}

function roi(netProfit, totalInvestment) {
  if (totalInvestment === 0) return null;
  return Math.round((netProfit / totalInvestment) * 100 * 100) / 100;
}

/**
 * @param {object} data
 * @param {number[]} data.cash_flows - 0-р индекс = анхны хөрөнгө оруулалт (сөрөг), дараагийн нь жил бүрийн цэвэр орлого
 * @param {number} [data.discount_rate=0.15]
 * @param {number} [data.annual_debt_service]
 * @param {{fixed_costs:number, unit_price:number, unit_variable_cost:number}} [data.break_even]
 * @param {number} [data.roi_year]
 */
function calculateFinance(data) {
  if (!Array.isArray(data.cash_flows) || data.cash_flows.length < 2) {
    throw new Error("cash_flows массив дор хаяж 2 элементтэй байх ёстой (0-р жил = анхны хөрөнгө оруулалт, сөрөг тоогоор).");
  }
  const cashFlows = data.cash_flows.map(Number);
  const discountRate = data.discount_rate ?? 0.15;
  const annualDebtService = data.annual_debt_service;

  const irrValue = irr(cashFlows);
  const totalInvestment = Math.abs(cashFlows[0]);

  const result = {
    npv: Math.round(npv(discountRate, cashFlows)),
    npv_discount_rate_used: discountRate,
    irr: irrValue !== null && irrValue !== undefined ? Math.round(irrValue * 100 * 100) / 100 : null,
    payback_period_years: paybackPeriod(cashFlows),
    total_investment: totalInvestment,
    cumulative_cash_flow_by_year: [],
  };

  let cumulative = 0;
  cashFlows.forEach((cf, i) => {
    cumulative += cf;
    result.cumulative_cash_flow_by_year.push({ year: i, cash_flow: cf, cumulative });
  });

  if (annualDebtService && cashFlows.length > 1) {
    const dscrByYear = [];
    for (let i = 1; i < cashFlows.length; i++) {
      dscrByYear.push({ year: i, dscr: Math.round((cashFlows[i] / annualDebtService) * 100) / 100 });
    }
    result.dscr_by_year = dscrByYear;
    result.dscr_note = "DSCR >= 1.2 ихэвчлэн банкны шаардлагыг хангасан гэж үзнэ; 1.0-с бага бол зээлийн эргэн төлөлтөд эрсдэлтэй.";
  }

  if (data.break_even) {
    result.break_even_point = breakEvenPoint(
      data.break_even.fixed_costs,
      data.break_even.unit_price,
      data.break_even.unit_variable_cost
    );
  }

  const roiYear = data.roi_year ?? cashFlows.length - 1;
  if (roiYear > 0 && roiYear < cashFlows.length) {
    result.roi = roi(cashFlows[roiYear], totalInvestment);
    result.roi_year_used = roiYear;
  }

  return result;
}

/**
 * payroll_calc.py-ийн шилжүүлсэн хувилбар.
 * @param {object} data
 * @param {{title:string, count:number, gross_salary:number}[]} data.positions
 * @param {number} [data.employer_social_insurance_rate=0.135]
 * @param {number} [data.employee_social_insurance_rate=0.115]
 * @param {number} [data.income_tax_rate=0.10]
 */
function calculatePayroll(data) {
  if (!Array.isArray(data.positions) || data.positions.length === 0) {
    throw new Error("positions массив хоосон байна.");
  }
  const erRate = data.employer_social_insurance_rate ?? 0.135;
  const eeRate = data.employee_social_insurance_rate ?? 0.115;
  const taxRate = data.income_tax_rate ?? 0.10;

  const rows = [];
  let totalMonthlyGross = 0;
  let totalMonthlyEmployerCost = 0;

  for (const pos of data.positions) {
    const gross = Number(pos.gross_salary);
    const count = Number(pos.count);
    const employeeSocial = Math.round(gross * eeRate);
    const incomeTax = Math.round((gross - employeeSocial) * taxRate);
    const netPay = gross - employeeSocial - incomeTax;
    const employerSocial = Math.round(gross * erRate);
    const totalEmployerCostPerPerson = gross + employerSocial;

    rows.push({
      title: pos.title,
      count,
      gross_salary: gross,
      employee_social_insurance: employeeSocial,
      income_tax: incomeTax,
      net_pay: netPay,
      employer_social_insurance: employerSocial,
      total_employer_cost_per_person: totalEmployerCostPerPerson,
      total_employer_cost_all: totalEmployerCostPerPerson * count,
    });
    totalMonthlyGross += gross * count;
    totalMonthlyEmployerCost += totalEmployerCostPerPerson * count;
  }

  return {
    positions: rows,
    total_monthly_gross_payroll: totalMonthlyGross,
    total_monthly_employer_cost: totalMonthlyEmployerCost,
    total_annual_employer_cost: totalMonthlyEmployerCost * 12,
    rates_used: { employer_social_insurance: erRate, employee_social_insurance: eeRate, income_tax: taxRate },
    warning: "Эдгээр хувь хэмжээг Татварын ерөнхий газар, Нийгмийн даатгалын ерөнхий газрын тухайн жилийн албан ёсны мэдээллээр баталгаажуулна уу.",
  };
}

module.exports = { calculateFinance, calculatePayroll, npv, irr, paybackPeriod, breakEvenPoint, roi };
