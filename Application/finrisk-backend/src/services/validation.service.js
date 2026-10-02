// ============================================================
// FINANCIAL DATA VALIDATION SERVICE
// ============================================================

export function validateFinancialData(data) {
  const errors = [];
  const warnings = [];

  // ------------------------------------------------------------
  // 1. REQUIRED FIELDS
  // ------------------------------------------------------------

  const requiredFields = [
    "company",
    "fiscal_year",
    "revenue",
    "cost_of_goods_sold",
    "gross_profit",
    "operating_expenses",
    "operating_income",
    "net_income",
    "cash",
    "current_assets",
    "total_assets",
    "current_liabilities",
    "total_liabilities",
    "total_equity",
    "operating_cash_flow"
  ];

  for (const field of requiredFields) {
    if (
      data[field] === null ||
      data[field] === undefined ||
      data[field] === ""
    ) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // ------------------------------------------------------------
  // 2. NUMERIC FIELD VALIDATION
  // ------------------------------------------------------------

  const numericFields = [
    "revenue",
    "cost_of_goods_sold",
    "gross_profit",
    "operating_expenses",
    "operating_income",
    "income_before_tax",
    "income_tax",
    "net_income",
    "diluted_eps",
    "cash",
    "short_term_investments",
    "accounts_receivable",
    "inventory",
    "current_assets",
    "total_assets",
    "accounts_payable",
    "short_term_debt",
    "current_liabilities",
    "long_term_debt",
    "total_liabilities",
    "total_equity",
    "operating_cash_flow",
    "investing_cash_flow",
    "financing_cash_flow",
    "net_cash_change",
    "beginning_cash",
    "ending_cash",
    "total_debt"
  ];

  for (const field of numericFields) {
    if (
      data[field] !== null &&
      data[field] !== undefined &&
      typeof data[field] !== "number"
    ) {
      errors.push(`Field ${field} must be a number`);
    }
  }

  // ------------------------------------------------------------
  // 3. NON-NEGATIVE VALUE CHECK
  // ------------------------------------------------------------

  const normallyNonNegative = [
    "revenue",
    "cost_of_goods_sold",
    "gross_profit",
    "operating_expenses",
    "cash",
    "short_term_investments",
    "accounts_receivable",
    "inventory",
    "current_assets",
    "total_assets",
    "accounts_payable",
    "short_term_debt",
    "current_liabilities",
    "long_term_debt",
    "total_liabilities",
    "total_equity",
    "total_debt"
  ];

  for (const field of normallyNonNegative) {
    if (
      data[field] !== null &&
      data[field] !== undefined &&
      data[field] < 0
    ) {
      warnings.push(
        `${field} has a negative value: ${data[field]}`
      );
    }
  }

  // ------------------------------------------------------------
  // 4. INCOME STATEMENT CONSISTENCY
  // ------------------------------------------------------------

  if (
    isNumber(data.revenue) &&
    isNumber(data.cost_of_goods_sold) &&
    isNumber(data.gross_profit)
  ) {
    const calculatedGrossProfit =
      data.revenue - data.cost_of_goods_sold;

    if (!approximatelyEqual(
      calculatedGrossProfit,
      data.gross_profit
    )) {
      warnings.push(
        `Gross profit mismatch. Expected approximately ${calculatedGrossProfit}, found ${data.gross_profit}`
      );
    }
  }

  if (
    isNumber(data.gross_profit) &&
    isNumber(data.operating_expenses) &&
    isNumber(data.operating_income)
  ) {
    const calculatedOperatingIncome =
      data.gross_profit - data.operating_expenses;

    if (!approximatelyEqual(
      calculatedOperatingIncome,
      data.operating_income
    )) {
      warnings.push(
        `Operating income mismatch. Expected approximately ${calculatedOperatingIncome}, found ${data.operating_income}`
      );
    }
  }

  // ------------------------------------------------------------
  // 5. BALANCE SHEET CHECK
  // ------------------------------------------------------------

  if (
    isNumber(data.total_assets) &&
    isNumber(data.total_liabilities) &&
    isNumber(data.total_equity)
  ) {
    const calculatedAssets =
      data.total_liabilities + data.total_equity;

    if (!approximatelyEqual(
      calculatedAssets,
      data.total_assets
    )) {
      warnings.push(
        `Balance sheet mismatch. Liabilities + Equity = ${calculatedAssets}, Total Assets = ${data.total_assets}`
      );
    }
  }

  // ------------------------------------------------------------
  // 6. CURRENT ASSETS CHECK
  // ------------------------------------------------------------

  if (
    isNumber(data.current_assets) &&
    isNumber(data.cash) &&
    isNumber(data.short_term_investments) &&
    isNumber(data.accounts_receivable) &&
    isNumber(data.inventory)
  ) {
    const knownCurrentAssets =
      data.cash +
      data.short_term_investments +
      data.accounts_receivable +
      data.inventory;

    if (knownCurrentAssets > data.current_assets) {
      warnings.push(
        `Known current assets (${knownCurrentAssets}) exceed reported current assets (${data.current_assets})`
      );
    }
  }

  // ------------------------------------------------------------
  // 7. DEBT CHECK
  // ------------------------------------------------------------

  if (
    isNumber(data.short_term_debt) &&
    isNumber(data.long_term_debt) &&
    isNumber(data.total_debt)
  ) {
    const calculatedDebt =
      data.short_term_debt + data.long_term_debt;

    if (!approximatelyEqual(
      calculatedDebt,
      data.total_debt
    )) {
      warnings.push(
        `Debt mismatch. Short-term + Long-term debt = ${calculatedDebt}, reported total debt = ${data.total_debt}`
      );
    }
  }

  // ------------------------------------------------------------
  // 8. CASH FLOW CHECK
  // ------------------------------------------------------------

  if (
    isNumber(data.beginning_cash) &&
    isNumber(data.net_cash_change) &&
    isNumber(data.ending_cash)
  ) {
    const calculatedEndingCash =
      data.beginning_cash + data.net_cash_change;

    if (!approximatelyEqual(
      calculatedEndingCash,
      data.ending_cash
    )) {
      warnings.push(
        `Cash flow mismatch. Beginning cash + net change = ${calculatedEndingCash}, ending cash = ${data.ending_cash}`
      );
    }
  }

  // ------------------------------------------------------------
  // 9. CASH FLOW COMPONENT CHECK
  // ------------------------------------------------------------

  if (
    isNumber(data.operating_cash_flow) &&
    isNumber(data.investing_cash_flow) &&
    isNumber(data.financing_cash_flow) &&
    isNumber(data.net_cash_change)
  ) {
    const calculatedCashChange =
      data.operating_cash_flow +
      data.investing_cash_flow +
      data.financing_cash_flow;

    if (!approximatelyEqual(
      calculatedCashChange,
      data.net_cash_change
    )) {
      warnings.push(
        `Cash flow components mismatch. Operating + Investing + Financing = ${calculatedCashChange}, reported net change = ${data.net_cash_change}`
      );
    }
  }

  // ------------------------------------------------------------
  // 10. PROFITABILITY SANITY CHECKS
  // ------------------------------------------------------------

  if (
    isNumber(data.revenue) &&
    isNumber(data.gross_profit) &&
    data.gross_profit > data.revenue
  ) {
    errors.push(
      "Gross profit cannot be greater than revenue"
    );
  }

  if (
    isNumber(data.revenue) &&
    isNumber(data.cost_of_goods_sold) &&
    data.cost_of_goods_sold > data.revenue
  ) {
    warnings.push(
      "Cost of goods sold is greater than revenue"
    );
  }

  // ------------------------------------------------------------
  // FINAL RESULT
  // ------------------------------------------------------------

  return {
    is_valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      total_errors: errors.length,
      total_warnings: warnings.length
    }
  };
}


// ============================================================
// HELPER FUNCTIONS
// ============================================================

function isNumber(value) {
  return typeof value === "number" && !Number.isNaN(value);
}


function approximatelyEqual(a, b, tolerance = 1) {
  return Math.abs(a - b) <= tolerance;
}