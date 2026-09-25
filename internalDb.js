const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const TABLES_DIR = path.join(DATA_DIR, "tables");

function ensureTableFolder() {
  fs.mkdirSync(TABLES_DIR, { recursive: true });
}

function getTablePath(tableName) {
  ensureTableFolder();
  return path.join(TABLES_DIR, `${tableName}.json`);
}

function readTable(tableName) {
  const filePath = getTablePath(tableName);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "[]", "utf8");
    return [];
  }

  try {
    const content = fs.readFileSync(filePath, "utf8").trim();
    return content ? JSON.parse(content) : [];
  } catch (err) {
    console.error(`❌ Failed to read ${tableName} table:`, err.message);
    return [];
  }
}

function writeTable(tableName, rows) {
  const filePath = getTablePath(tableName);
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), "utf8");
  return rows;
}

function compareValues(left, right) {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return -1;
  if (right === undefined) return 1;

  const leftTime = left instanceof Date ? left.getTime() : Date.parse(left);
  const rightTime = right instanceof Date ? right.getTime() : Date.parse(right);

  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
    return leftTime - rightTime;
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  if (String(left) < String(right)) return -1;
  if (String(left) > String(right)) return 1;
  return 0;
}

function getNestedValue(obj, keyPath) {
  if (!obj || !keyPath) return obj;
  return keyPath.split(".").reduce((acc, part) => acc && acc[part], obj);
}

function matchesQuery(record, filter = {}) {
  if (!filter || Object.keys(filter).length === 0) return true;

  return Object.entries(filter).every(([key, expected]) => {
    const value = getNestedValue(record, key);

    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if (Object.prototype.hasOwnProperty.call(expected, "$in")) {
        return Array.isArray(expected.$in) ? expected.$in.includes(value) : true;
      }
      if (Object.prototype.hasOwnProperty.call(expected, "$ne")) {
        return value !== expected.$ne;
      }
      if (Object.prototype.hasOwnProperty.call(expected, "$gte")) {
        return compareValues(value, expected.$gte) >= 0;
      }
      if (Object.prototype.hasOwnProperty.call(expected, "$gt")) {
        return compareValues(value, expected.$gt) > 0;
      }
      if (Object.prototype.hasOwnProperty.call(expected, "$lte")) {
        return compareValues(value, expected.$lte) <= 0;
      }
      if (Object.prototype.hasOwnProperty.call(expected, "$lt")) {
        return compareValues(value, expected.$lt) < 0;
      }
    }

    return value === expected;
  });
}

function sortRecords(rows, sortSpec = {}) {
  if (!sortSpec || Object.keys(sortSpec).length === 0) return rows;

  const sorted = [...rows];
  const entries = Object.entries(sortSpec);

  sorted.sort((a, b) => {
    for (const [key, direction] of entries) {
      const order = direction === -1 ? -1 : 1;
      const comparison = compareValues(getNestedValue(a, key), getNestedValue(b, key));
      if (comparison !== 0) {
        return comparison * order;
      }
    }
    return 0;
  });

  return sorted;
}

function createId(prefix = "row") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function ensureRecord(record, tableName) {
  const cloned = { ...record };
  if (!cloned._id) {
    cloned._id = createId(tableName);
  }
  if (!cloned.createdAt) {
    cloned.createdAt = new Date().toISOString();
  }
  cloned.updatedAt = new Date().toISOString();
  return cloned;
}

function makeQueryResult(tableName, fetchRows) {
  const runner = () => Promise.resolve().then(fetchRows);
  const query = Object.assign(runner, {
    then: (resolve, reject) => runner().then(resolve, reject),
    catch: (reject) => runner().catch(reject),
    finally: (onFinally) => runner().finally(onFinally)
  });

  query.sort = (sortSpec) => {
    return makeQueryResult(tableName, async () => {
      const rows = await runner();
      return sortRecords(rows, sortSpec);
    });
  };

  return query;
}

function createTableStore(tableName) {
  const store = {
    async create(record = {}) {
      const rows = readTable(tableName);
      const nextRecord = ensureRecord(record, tableName);
      rows.push(nextRecord);
      writeTable(tableName, rows);
      return { ...nextRecord };
    },

    find(query = {}, projection = {}) {
      return makeQueryResult(tableName, async () => {
        const rows = readTable(tableName);
        const filtered = rows.filter((row) => matchesQuery(row, query));
        return filtered.map((row) => ({ ...row }));
      });
    },

    async findOne(query = {}) {
      const rows = readTable(tableName);
      const match = rows.find((row) => matchesQuery(row, query));
      return match ? { ...match } : null;
    },

    async updateOne(filter = {}, update = {}) {
      const rows = readTable(tableName);
      let changed = 0;

      const nextRows = rows.map((row) => {
        if (!matchesQuery(row, filter)) return row;
        changed += 1;
        const merged = { ...row, ...update, updatedAt: new Date().toISOString() };
        return merged;
      });

      writeTable(tableName, nextRows);
      return { acknowledged: true, matchedCount: changed, modifiedCount: changed };
    },

    async findOneAndUpdate(filter = {}, update = {}, options = {}) {
      const rows = readTable(tableName);
      const index = rows.findIndex((row) => matchesQuery(row, filter));

      if (index === -1) {
        return null;
      }

      const existing = rows[index];
      const updated = { ...existing, ...update, updatedAt: new Date().toISOString() };
      rows[index] = updated;
      writeTable(tableName, rows);

      const saved = { ...updated };
      saved.save = async () => {
        const allRows = readTable(tableName);
        const targetIndex = allRows.findIndex((row) => row._id === saved._id);
        if (targetIndex !== -1) {
          allRows[targetIndex] = { ...saved, updatedAt: new Date().toISOString() };
          writeTable(tableName, allRows);
        }
        return { ...saved };
      };

      return options.new === false ? { ...existing } : saved;
    }
  };

  return store;
}

module.exports = {
  createTableStore,
  readTable,
  writeTable,
  ensureTableFolder,
  matchesQuery,
  sortRecords,
  ensureRecord
};
