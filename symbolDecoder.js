const MONTH_MAP = {
  JAN: "JAN",
  FEB: "FEB",
  MAR: "MAR",
  APR: "APR",
  MAY: "MAY",
  JUN: "JUN",
  JUL: "JUL",
  AUG: "AUG",
  SEP: "SEP",
  OCT: "OCT",
  NOV: "NOV",
  DEC: "DEC"
};

// ==============================
// 🔥 MCX SYMBOL LIST (EXPANDABLE)
// ==============================
const MCX_SYMBOLS = [
  "GOLD",
  "GOLDM",
  "GOLDPETAL",
  "SILVER",
  "SILVERM",
  "SILVERMIC",
  "CRUDEOIL",
  "NATGAS",
  "COPPER",
  "ZINC",
  "LEAD",
  "ALUMINIUM"
];

// ==============================
// 🧠 UNIVERSAL SYMBOL DECODER
// ==============================
function decodeSymbol(raw) {
  if (!raw) {
    throw new Error("Empty symbol");
  }

  raw = raw.trim().toUpperCase();

  // ==============================
  // 🧠 HELPER → EXCHANGE DETECTION
  // ==============================
  const isMCX = (symbol) => {
    return MCX_SYMBOLS.some(s => symbol.startsWith(s));
  };

  // ==============================
  // ✅ 1. OPTION FORMAT
  // BANKNIFTY 43000 CE 26 MAY 26
  // ==============================
  let optMatch = raw.match(
    /^([A-Z]+)\s+(\d+)\s+(CE|PE)\s+(\d{1,2})\s+([A-Z]{3})\s+(\d{2})$/
  );

  if (optMatch) {
    const [, symbol, strike, optionType, day, month, year] = optMatch;

    const exchange = isMCX(symbol) ? "MCX_FO" : "NFO";

    return {
      symbol,
      strike: Number(strike),
      optionType,
      day: day.padStart(2, "0"),
      month,
      year,
      instrumentType: "OPT",
      exchange,
      tradingSymbol: raw,
      isDecoded: true
    };
  }

  // ==============================
  // ✅ 2. FUTURE FORMAT
  // GOLDPETAL FUT 29 MAY 26
  // ==============================
  let futMatch = raw.match(
    /^([A-Z]+)\s+FUT\s+(\d{1,2})\s+([A-Z]{3})\s+(\d{2})$/
  );

  if (futMatch) {
    const [, symbol, day, month, year] = futMatch;

    const exchange = isMCX(symbol) ? "MCX_FO" : "NFO";

    return {
      symbol,
      day: day.padStart(2, "0"),
      month,
      year,
      instrumentType: "FUT",
      exchange,
      tradingSymbol: raw,
      isDecoded: true
    };
  }

  // ==============================
  // ✅ 3. COMPACT OPTION FORMAT
  // BANKNIFTY26052643000CE
  // ==============================
  let compactMatch = raw.match(
    /^([A-Z]+)(\d{2})(\d{2})(\d{2})(\d+)(CE|PE)$/
  );

  if (compactMatch) {
    const [, symbol, year, month, day, strike, type] = compactMatch;

    const monthNames = [
      "JAN","FEB","MAR","APR","MAY","JUN",
      "JUL","AUG","SEP","OCT","NOV","DEC"
    ];

    const monthName = monthNames[Number(month) - 1];

    const exchange = isMCX(symbol) ? "MCX_FO" : "NFO";

    return {
      symbol,
      strike: Number(strike),
      optionType: type,
      day,
      month: monthName,
      year,
      instrumentType: "OPT",
      exchange,
      tradingSymbol: `${symbol} ${strike} ${type} ${day} ${monthName} ${year}`,
      isDecoded: true
    };
  }

  // ==============================
  // ✅ 4. EQUITY FORMAT
  // SBIN
  // ==============================
  let eqMatch = raw.match(/^([A-Z]+)$/);

  if (eqMatch) {
    const symbol = eqMatch[1];

    return {
      symbol,
      instrumentType: "EQ",
      exchange: "NSE",
      tradingSymbol: symbol,
      isDecoded: true
    };
  }

  // ==============================
  // ❌ INVALID FORMAT
  // ==============================
  throw new Error("Invalid symbol format: " + raw);
}

module.exports = { decodeSymbol };
