const axios = require("axios");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

async function syncInstruments() {
  const segments = ["NSE", "BSE", "MCX", "NSE_FO"];
  console.log("📥 Starting instrument sync for:", segments.join(", "));

  const allRows = [];

  try {
    for (const segment of segments) {
      try {
        await new Promise(r => setTimeout(r, 1000));

        const url = `https://assets.upstox.com/market-quote/instruments/exchange/${segment}.json.gz`;
        console.log(`🌐 Fetching ${segment} instruments...`);

const response = await axios({
  method: "get",
  url,
  responseType: "stream",
  timeout: 30000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://upstox.com/",
    "Origin": "https://upstox.com",
    "Connection": "keep-alive"
  }
});

        const gunzip = zlib.createGunzip();
        let chunks = [];

        response.data.pipe(gunzip);

        await new Promise((resolve, reject) => {
          gunzip.on("data", chunk => chunks.push(chunk));
          gunzip.on("end", resolve);
          gunzip.on("error", reject);
        });

        const rawData = Buffer.concat(chunks).toString();
        let instruments = JSON.parse(rawData);

        if (!Array.isArray(instruments) && Array.isArray(instruments.data)) {
          instruments = instruments.data;
        }

        if (!Array.isArray(instruments)) {
          console.log("Invalid format for", segment);
          continue;
        }

        console.log(`📊 ${segment}: ${instruments.length} instruments`);

        const filtered = instruments.filter(inst => {
          if (!inst.instrument_key || !inst.trading_symbol) return false;

          const type = (inst.instrument_type || "").toUpperCase();
          const seg = (inst.segment || "").toUpperCase();

          return (
            type.startsWith("EQ") ||
            type === "INDEX" ||
            type.includes("FUT") ||
            type.includes("OPT") ||
            type === "CE" ||
            type === "PE" ||
            seg.includes("FO")
          );
        });

        for (const inst of filtered) {
          let expiryDate = "";

          if (inst.expiry && inst.expiry !== "0") {
            const d = new Date(inst.expiry);
            if (!isNaN(d.getTime())) {
              expiryDate = d.toISOString().split("T")[0];
            }
          }

          allRows.push({
            trading_symbol: inst.trading_symbol,
            name: inst.name || "",
            instrument_key: inst.instrument_key,
            exchange: inst.exchange || "",
            instrument_type: inst.instrument_type || "",
            expiry: expiryDate,
            lot_size: inst.lot_size || "",
            strike_price: inst.strike_price || "",
            segment: inst.segment || ""
          });
        }

        console.log(`✅ ${segment} done`);

      } catch (err) {
        console.error(`❌ Error in ${segment}:`, err.message);
      }
    }

    // -------------------------
    // WRITE CSV FILE
    // -------------------------
    const dataDir = path.join(__dirname, "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir);
    }

    const filePath = path.join(dataDir, "instruments.csv");

    const headers = [
      "trading_symbol",
      "name",
      "instrument_key",
      "exchange",
      "instrument_type",
      "expiry",
      "lot_size",
      "strike_price",
      "segment"
    ];

    const csvLines = [];
    csvLines.push(headers.join(","));

    for (const row of allRows) {
      csvLines.push(
        headers.map(h => {
          const val = row[h] ?? "";
          // escape commas
          return `"${String(val).replace(/"/g, '""')}"`;
        }).join(",")
      );
    }

    fs.writeFileSync(filePath, csvLines.join("\n"));

    console.log(`✨ CSV saved successfully!`);
    console.log(`📁 Location: ${filePath}`);
    console.log(`📊 Total rows: ${allRows.length}`);

    return { success: true, total: allRows.length, file: filePath };

  } catch (error) {
    console.error("❌ Sync failed:", error.message);
    return { success: false, error: error.message };
  }
}

// Run directly
if (require.main === module) {
  syncInstruments().then(() => process.exit(0));
}

module.exports = syncInstruments;