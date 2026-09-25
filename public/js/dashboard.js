const socket = window.io ? io() : null;

let tradeData = [];
let positionData = [];

// DOM shortcuts
const signals = document.getElementById("signals");
const orders = document.getElementById("orders");
const profile = document.getElementById("profile");
const accountHeader = document.getElementById("accountHeader");
const controlStatus = document.getElementById("controlStatus");
const positionsTable = document.getElementById("positionsTable");
const tradesTable = document.getElementById("tradesTable");
const pnl = document.getElementById("pnl");
const daily = document.getElementById("daily");

// ================= SOCKET =================
if (socket) {
  socket.on("signal", d => {
    const li = document.createElement("li");
    li.innerText = JSON.stringify(d);
    signals.prepend(li);
  });

  const showOrderEvent = d => {
    const li = document.createElement("li");
    li.innerText = JSON.stringify(d);
    orders.prepend(li);
  };

  socket.on("order", showOrderEvent);
  socket.on("order_update", showOrderEvent);
} else {
  console.warn("Socket.IO is unavailable; dashboard will run in polling-only mode.");
}

// ================= CONTROL =================
async function startTrading() { await fetch("/start"); }
async function stopTrading() { await fetch("/stop"); }
function loginUpstox() { window.location.href = "/login-upstox"; }

function showFlashMessage(text, type = "success") {
  const flash = document.createElement("div");
  flash.innerText = text;
  flash.style.position = "fixed";
  flash.style.top = "16px";
  flash.style.right = "16px";
  flash.style.padding = "10px 14px";
  flash.style.borderRadius = "8px";
  flash.style.zIndex = "9999";
  flash.style.fontSize = "13px";
  flash.style.fontWeight = "600";
  flash.style.border = "1px solid";

  if (type === "success") {
    flash.style.background = "#14532d";
    flash.style.borderColor = "#22c55e";
    flash.style.color = "#dcfce7";
  } else {
    flash.style.background = "#7f1d1d";
    flash.style.borderColor = "#ef4444";
    flash.style.color = "#fee2e2";
  }

  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 3000);
}

function handleRedirectFlash() {
  const params = new URLSearchParams(window.location.search);
  const brokerLogin = params.get("brokerLogin");

  if (brokerLogin === "success") {
    showFlashMessage("Broker login successful");
    params.delete("brokerLogin");
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  }
}

// ================= PROFILE =================
async function loadProfile() {
  try {
    const res = await fetch("/profile");
    const text = await res.text();
    let d = {};

    try {
      d = text ? JSON.parse(text) : {};
    } catch (err) {
      d = {};
    }

    const name = d.name || d.user_name || "N/A";
    const clientId = d.clientId || d.user_id || "N/A";
    const isConnected = Boolean(d.brokerConnected || d.loggedIn || (name !== "N/A" && clientId !== "N/A"));

    profile.innerHTML = `
      <div class="profile-name">${name !== "N/A" ? name : "Not Logged In"}</div>
      <div>Login ID: ${clientId !== "N/A" ? clientId : "Not available"}</div>
      <div style="margin-top:6px; color:${isConnected ? '#22c55e' : '#ef4444'}; font-weight:600;">
        ${isConnected ? 'Connected' : 'Disconnected'}
      </div>
    `;

    if (accountHeader) {
      accountHeader.innerHTML = `
        <span class="dot ${isConnected ? 'on' : 'off'}"></span>
        <span class="profile-name">${name !== "N/A" ? name : 'Broker not connected'}</span>
        <span>(${clientId !== "N/A" ? clientId : 'Login ID unavailable'})</span>
      `;
    }
  } catch (err) {
    profile.innerHTML = "<div>Broker profile unavailable</div>";

    if (accountHeader) {
      accountHeader.innerHTML = '<span class="dot off"></span><span>Broker disconnected</span>';
    }
  }
}

// ================= CONTROL STATUS =================
async function loadControl() {
  try {
    const res = await fetch("/control");
    const d = await res.json();

    controlStatus.innerHTML = d.trading
      ? '<span class="dot on"></span> Trading ON'
      : '<span class="dot off"></span> Trading OFF';
  } catch (err) {
    controlStatus.innerHTML = '<span class="dot off"></span> Trading OFF';
  }
}

// ================= POSITIONS =================
async function loadPositions() {
  const res = await fetch("/positions");
  const data = await res.json();

  positionData = data;

  let total = 0;
  positionsTable.innerHTML = "";

  data.forEach(p => {
    const type = p.quantity >= 0 ? "BUY" : "SELL";
    const pnlVal = p.pnl || 0;
    const cls = pnlVal >= 0 ? "profit" : "loss";

    // UI must show ONLY backend-provided values (from Trade collection)
    const entryPrice = p.entry_price || 0;
    const targetPrice = p.target_price || 0;

    positionsTable.innerHTML += `
      <tr>
        <td>${p.trading_symbol}</td>
        <td>${Math.abs(p.quantity)}</td>
        <td>${type}</td>
        <td>${entryPrice}</td>
        <td>${p.last_price}</td>
        <td>${targetPrice}</td>
        <td class="${cls}">${pnlVal}</td>
      </tr>
    `;

    total += pnlVal;
  });

  pnl.innerText = total.toFixed(2);
}

// ================= TRADES (INTRADAY ONLY) =================
async function loadTrades() {
  const res = await fetch("/trades?type=intraday");
  const data = await res.json();

  tradeData = data;
  tradesTable.innerHTML = "";

  data.forEach(t => {
  const dt = new Date(t.time);

  const date = dt.toLocaleDateString();
  const time = dt.toLocaleTimeString();

  const cls = t.pnl >= 0 ? "profit" : "loss";

  const tradedPrice =
    t.avg_price || t.entry_price || t.price || 0;

  tradesTable.innerHTML += `
    <tr>
      <td>${date}</td>
      <td>${time}</td>
      <td>${t.instrument}</td>
      <td>${t.quantity}</td>
      <td>${t.side}</td>
      <td>${tradedPrice}</td>
      <td class="${cls}">${t.status}</td>
    </tr>
  `;
});}

// ================= DAILY =================
async function loadPnL() {
  const res = await fetch("/pnl");
  const d = await res.json();

  daily.innerText = `Trades: ${d.totalTrades} | PnL: ${d.totalPnL}`;
}

// ================= AUTO REFRESH =================
setInterval(() => {
  loadControl();
  loadProfile();
  loadPositions();
  loadTrades();
  loadPnL();
}, 3000);

// ================= INIT =================
loadControl();
loadProfile();
loadPositions();
loadTrades();
loadPnL();
handleRedirectFlash();

//============ Sign in =====================

let isLoggedIn = false;

async function checkUserLogin() {
  const res = await fetch("/profile");
  const data = await res.json();

  const btn = document.getElementById("authBtn");

  if (data.loggedIn) {
    isLoggedIn = true;
    btn.innerText = "Sign Out";
  } else {
    isLoggedIn = false;
    btn.innerText = "Sign In";
  }
}

function handleAuth() {
  if (isLoggedIn) {
    window.location.href = "/logout";
  } else {
    window.location.href = "/dashboard.html";
  }
}

// run on page load
checkUserLogin();
