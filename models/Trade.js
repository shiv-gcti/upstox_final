const { createTableStore, readTable, writeTable, ensureRecord, sortRecords, matchesQuery } = require("../internalDb");

const DEFAULT_TABLE = "trades";

function decorateRecord(record, tableName) {
  if (!record) return record;
  const doc = { ...record };
  doc.save = async () => {
    const rows = readTable(tableName);
    const index = rows.findIndex((row) => row._id === doc._id);
    if (index === -1) {
      rows.push(ensureRecord(doc, tableName));
      writeTable(tableName, rows);
      return { ...ensureRecord(doc, tableName) };
    }

    const updated = { ...rows[index], ...doc, updatedAt: new Date().toISOString() };
    rows[index] = updated;
    writeTable(tableName, rows);
    return { ...updated };
  };
  return doc;
}

const Trade = {
  modelName: "Trade",
  tableName: DEFAULT_TABLE,

  forTable(tableName) {
    return Object.assign(Object.create(Trade), {
      tableName: tableName || DEFAULT_TABLE
    });
  },

  getTableName() {
    return this.tableName || DEFAULT_TABLE;
  },

  async create(record = {}) {
    const tableName = this.getTableName();
    const store = createTableStore(tableName);
    const created = await store.create({
      time: new Date(),
      ...record,
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    return decorateRecord(created, tableName);
  },

  find(query = {}, projection = {}) {
    const tableName = this.getTableName();
    const builder = () => Promise.resolve().then(async () => {
      const rows = readTable(tableName);
      const filtered = rows.filter((row) => matchesQuery(row, query));
      const sorted = sortRecords(filtered, { createdAt: -1 });
      return sorted.map((row) => decorateRecord(row, tableName));
    });

    const queryResult = Object.assign(builder, {
      then: (resolve, reject) => builder().then(resolve, reject),
      catch: (reject) => builder().catch(reject),
      finally: (onFinally) => builder().finally(onFinally)
    });

    queryResult.sort = (sortSpec = {}) => {
      const sortedBuilder = () => Promise.resolve().then(async () => {
        const rows = readTable(tableName);
        const filtered = rows.filter((row) => matchesQuery(row, query));
        return sortRecords(filtered, sortSpec).map((row) => decorateRecord(row, tableName));
      });

      return Object.assign(sortedBuilder, {
        then: (resolve, reject) => sortedBuilder().then(resolve, reject),
        catch: (reject) => sortedBuilder().catch(reject),
        finally: (onFinally) => sortedBuilder().finally(onFinally)
      });
    };

    return queryResult;
  },

  async findOne(query = {}) {
    const tableName = this.getTableName();
    const rows = readTable(tableName);
    const match = rows.find((row) => matchesQuery(row, query));
    return match ? decorateRecord(match, tableName) : null;
  },

  async updateOne(filter = {}, update = {}) {
    const tableName = this.getTableName();
    const store = createTableStore(tableName);
    return store.updateOne(filter, update);
  },

  async clearAll() {
    const tableName = this.getTableName();
    const rows = readTable(tableName);
    writeTable(tableName, []);
    return {
      acknowledged: true,
      deletedCount: rows.length
    };
  },

  async findOneAndUpdate(filter = {}, update = {}, options = {}) {
    const tableName = this.getTableName();
    const rows = readTable(tableName);
    const index = rows.findIndex((row) => matchesQuery(row, filter));
    if (index === -1) {
      return null;
    }

    const current = rows[index];
    const updated = { ...current, ...update, updatedAt: new Date().toISOString() };
    rows[index] = updated;
    writeTable(tableName, rows);

    const saved = decorateRecord(updated, tableName);
    if (options.new === false) {
      return decorateRecord(current, tableName);
    }
    return saved;
  }
};

module.exports = Trade;
