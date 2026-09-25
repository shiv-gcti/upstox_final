const fs = require("fs");
const path = require("path");

const syncInstruments = require("./syncInstruments");

// ==============================
const DATA_DIR = path.join(__dirname, "data");
const FILE_PATH = path.join(DATA_DIR, "instruments.csv");

let instrumentCache = null;

// ==============================
function normalize(str) {
  if (!str) return "";
  return str
    .replace(/"/g, "")
    .replace(/\s+/g, "")
    .replace(/\r/g, "")
    .trim()
    .toUpperCase();
}

// ==============================
async function ensureLocalFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      console.log("📁 Created data directory");
    }

    if (fs.existsSync(FILE_PATH)) {
      const stats = fs.statSync(FILE_PATH);
      const mtime = new Date(stats.mtime);
      const now = new Date();
      const diffDays =
        (now.getTime() - mtime.getTime()) / (1000 * 60 * 60 * 24);

      if (diffDays < 7) {
        console.log("📁 Instrument CSV already exists (Updated < 7 days ago)");
        return true;
      }

      console.log(
        `⚠️ Instrument CSV is older than 7 days (${Math.floor(
          diffDays
        )} days old). Refreshing...`
      );
    } else {
      console.log("⚠️ Instrument CSV not found. Syncing...");
    }

    const result = await syncInstruments();
    return result && result.success;
  } catch (err) {
    console.log("❌ ensureLocalFile:", err.message);
    return false;
  }
}

// ==============================
function loadInstrumentCache() {
  if (instrumentCache) return instrumentCache;

  instrumentCache = new Map();

  try {
    const data = fs.readFileSync(FILE_PATH, "utf-8");
    const lines = data.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // ✅ FIXED CSV PARSER (handles commas inside quotes)
      const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);

      // skip header
      if (i === 0 && cols[0]?.toLowerCase().includes("instrument")) continue;

      // columns:
      // trading_symbol,name,instrument_key,exchange,instrument_type,expiry,lot_size,strike_price,segment
      const trading_symbol = cols[0]?.trim();
      const instrument_key = cols[2]?.trim();
      const lot_size_raw = cols[6]?.trim();

      if (!instrument_key || !trading_symbol) continue;

      const normalizedSymbol = normalize(trading_symbol);
      const normalizedKey = instrument_key.replace(/"/g, "");

      // ✅ SAFE LOT SIZE PARSE
      const lot_size =
        Number(lot_size_raw?.replace(/"/g, "").trim()) || 1;

      instrumentCache.set(normalizedSymbol, {
        instrument_key: normalizedKey,
        lot_size
      });

      // 🔍 Optional debug (enable if needed)
      // if (normalizedSymbol.includes("SBIN")) {
      //   console.log("DEBUG:", { trading_symbol, instrument_key, lot_size });
      // }
    }

    console.log("✅ Instrument cache loaded:", instrumentCache.size);
  } catch (err) {
    console.log("❌ Cache load error:", err.message);
  }

  return instrumentCache;
}

// ==============================
// 🔥 FINAL MATCH
// ==============================
function findInstrument(symbol) {
  const cache = loadInstrumentCache();

  const normalizedInput = normalize(symbol);

  const row = cache.get(normalizedInput);

  if (!row) {
    console.log("⚠️ NOT FOUND:", normalizedInput);
    return null;
  }

  console.log(
    "🎯 FOUND:",
    normalizedInput,
    "→",
    row.instrument_key,
    "| Lot:",
    row.lot_size
  );

  return {
    instrument_token: row.instrument_key,
    lot_size: row.lot_size
  };
}

// ==============================
module.exports = {
  ensureLocalFile,
  loadInstrumentCache,
  findInstrument
};
