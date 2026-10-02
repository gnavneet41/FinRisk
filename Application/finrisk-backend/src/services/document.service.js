import fs from "fs";
import mammoth from "mammoth";
import * as cheerio from "cheerio";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

export async function extractFinancialData(
  filePath,
  mimetype,
  originalName
) {
  const extension = originalName
    .toLowerCase()
    .substring(originalName.lastIndexOf("."));

  let text = "";

  // ============================================================
  // DOCX
  // ============================================================

  if (
    extension === ".docx" ||
    mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.convertToHtml({
      path: filePath
    });

    const $ = cheerio.load(result.value);

    text = $("body").text();

    console.log("\n========== DOCX TEXT ==========\n");
    console.log(text);
    console.log("\n================================\n");
  }

  // ============================================================
  // PDF
  // ============================================================

  else if (
    extension === ".pdf" ||
    mimetype === "application/pdf"
  ) {
    text = await extractPdfText(filePath);

    console.log("\n========== PDF TEXT ==========\n");
    console.log(text);
    console.log("\n==============================\n");
  }

  else {
    throw new Error(`Unsupported document format: ${extension}`);
  }

  return extractFinancialValues(text);
}


// ============================================================
// PDF TEXT EXTRACTION
// ============================================================

async function extractPdfText(filePath) {
  const dataBuffer = fs.readFileSync(filePath);

  // pdfjs-dist requires Uint8Array instead of Node Buffer
  const data = new Uint8Array(dataBuffer);

  const loadingTask = pdfjsLib.getDocument({
    data
  });

  const pdfDocument = await loadingTask.promise;

  let fullText = "";

  for (
    let pageNumber = 1;
    pageNumber <= pdfDocument.numPages;
    pageNumber++
  ) {
    const page = await pdfDocument.getPage(pageNumber);

    const content = await page.getTextContent();

    const pageText = content.items
      .map((item) => item.str)
      .join(" ");

    fullText += pageText + "\n";
  }

  return fullText;
}


// ============================================================
// FINANCIAL VALUE EXTRACTION
// ============================================================

function extractFinancialValues(text) {
  const normalizedText = text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();

  return {
    // ============================================================
    // COMPANY
    // ============================================================

    company: extractValue(
      normalizedText,
      /Company Name\s+(.+?)\s+Fiscal Year/i
    ), // null if not found — never default to a made-up company

    fiscal_year: extractValue(
      normalizedText,
      /Fiscal Year\s+(FY\d{4})/i
    ), // null if not found


    // ============================================================
    // INCOME STATEMENT
    // ============================================================

    revenue: extractNumber(
      normalizedText,
      /Revenue\s*\(Total Net Sales\)\s+([\d,]+)\s+[\d,]+/i
    ),

    cost_of_goods_sold: extractNumber(
      normalizedText,
      /Cost of Sales\s*\(Total Cost of Sales\)\s+([\d,]+)\s+[\d,]+/i
    ),

    gross_profit: extractNumber(
      normalizedText,
      /Gross Profit\s*\(Gross Margin\)\s+([\d,]+)\s+[\d,]+/i
    ),

    operating_expenses: extractNumber(
      normalizedText,
      /Operating Expenses\s*\(R&D \+ SG&A\)\s+([\d,]+)\s+[\d,]+/i
    ),

    operating_income: extractNumber(
      normalizedText,
      /Operating Income\s+([\d,]+)\s+[\d,]+/i
    ),

    income_before_tax: extractNumber(
      normalizedText,
      /Income Before Tax\s+([\d,]+)\s+[\d,]+/i
    ),

    income_tax: extractNumber(
      normalizedText,
      /Income Tax\s*\(Provision for Income Taxes\)\s+([\d,]+)\s+[\d,]+/i
    ),

    net_income: extractNumber(
      normalizedText,
      /Net Income\s+([\d,]+)\s+[\d,]+/i
    ),

    diluted_eps: extractNumber(
      normalizedText,
      /Diluted EPS\s+([\d.]+)\s+[\d.]+/i
    ),


    // ============================================================
    // BALANCE SHEET - ASSETS
    // ============================================================

    cash: extractNumber(
      normalizedText,
      /Cash and Cash Equivalents\s+([\d,]+)\s+[\d,]+/i
    ),

    short_term_investments: extractNumber(
      normalizedText,
      /Short\s*-\s*Term Investments\s*\(Current Marketable Securities\)\s+([\d,]+)\s+[\d,]+/i
    ),

    accounts_receivable: extractNumber(
      normalizedText,
      /Accounts Receivable,\s*net\s+([\d,]+)\s+[\d,]+/i
    ),

    inventory: extractNumber(
      normalizedText,
      /Inventory\s+([\d,]+)\s+[\d,]+/i
    ),

    current_assets: extractNumber(
      normalizedText,
      /Total Current Assets\s+([\d,]+)\s+[\d,]+/i
    ),

    total_assets: extractNumber(
      normalizedText,
      /Total Assets\s+([\d,]+)\s+[\d,]+/i
    ),


    // ============================================================
    // BALANCE SHEET - LIABILITIES
    // ============================================================

    accounts_payable: extractNumber(
      normalizedText,
      /Accounts Payable\s+([\d,]+)\s+[\d,]+/i
    ),

    short_term_debt: extractNumber(
      normalizedText,
      /Short\s*-\s*Term Debt\s*\(Commercial Paper \+ Current Portion of Term Debt\)\s+([\d,]+)\s+[\d,]+/i
    ),

    current_liabilities: extractNumber(
      normalizedText,
      /Total Current Liabilities\s+([\d,]+)\s+[\d,]+/i
    ),

    long_term_debt: extractNumber(
      normalizedText,
      /Long\s*-\s*Term Debt\s*\(Non\s*-\s*Current Term Debt\)\s+([\d,]+)\s+[\d,]+/i
    ),

    total_liabilities: extractNumber(
      normalizedText,
      /Total Liabilities\s+([\d,]+)\s+[\d,]+/i
    ),

    total_equity: extractNumber(
      normalizedText,
      /Total Shareholders' Equity\s+([\d,]+)\s+[\d,]+/i
    ),


    // ============================================================
    // CASH FLOW
    // ============================================================

    operating_cash_flow: extractNumber(
      normalizedText,
      /Cash Flow from Operating Activities\s+([\d,]+)\s+[\d,]+/i
    ),

    investing_cash_flow: extractNumber(
      normalizedText,
      /Cash Flow from Investing Activities\s+([\d,]+)\s+[\d,]+/i
    ),

    financing_cash_flow: extractNegativeNumber(
        normalizedText,
        /Cash Flow from Financing Activities\s+\(([\d,]+)\)\s+\([\d,]+\)/i
    ),

    net_cash_change: extractNegativeNumber(
        normalizedText,
        /Net Change in Cash\s*\(incl\. restricted cash\)\s+\(([\d,]+)\)\s+[\d,]+/i
    ),

    beginning_cash: extractNumber(
      normalizedText,
      /Beginning Cash Balance\s*\(incl\. restricted cash\)\s+([\d,]+)\s+[\d,]+/i
    ),

    ending_cash: extractNumber(
      normalizedText,
      /Ending Cash Balance\s*\(incl\. restricted cash\)\s+([\d,]+)\s+[\d,]+/i
    ),


    // ============================================================
    // KEY METRICS
    // ============================================================

    total_debt: extractNumber(
      normalizedText,
      /Total Debt\s*\(\$M\)\s+([\d,]+)\s+[\d,]+/i
    )
  };
}


// ============================================================
// HELPERS
// ============================================================

function extractValue(text, regex) {
  const match = text.match(regex);

  if (!match) {
    return null;
  }

  return match[1].trim();
}


function extractNumber(text, regex) {
  const match = text.match(regex);

  if (!match) {
    return null;
  }

  return Number(
    match[1]
      .replace(/,/g, "")
      .trim()
  );
}
function extractNegativeNumber(text, regex) {
  const match = text.match(regex);

  if (!match) {
    return null;
  }

  return -Number(
    match[1]
      .replace(/,/g, "")
      .trim()
  );
}