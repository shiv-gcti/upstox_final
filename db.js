async function connectDB() {
  console.log("✅ Using internal file-based tables for trade storage");
  return true;
}

module.exports = connectDB;
