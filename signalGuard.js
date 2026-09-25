const recent = new Map();

function isDuplicate(signal) {
  const key = `${signal.TS}_${signal.TT}_${signal.Q}`;

  if (recent.has(key)) {
    return true;
  }

  recent.set(key, Date.now());

  // auto cleanup after 10 seconds
  setTimeout(() => recent.delete(key), 10000);

  return false;
}

module.exports = { isDuplicate };