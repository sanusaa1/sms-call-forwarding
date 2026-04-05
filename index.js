const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

// 🔥 PROXY FIX
app.set("trust proxy", true);

// 🔥 LOAD ENV JSON
const adminJson = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const detectorJson = JSON.parse(process.env.SERVICE_ACCOUNT);

// 🔥 INIT APPS
admin.initializeApp({
  credential: admin.credential.cert(adminJson)
}, "adminApp");

const detectorApp = admin.initializeApp({
  credential: admin.credential.cert(detectorJson),
  databaseURL: "https://ip-detector-6a30f-default-rtdb.firebaseio.com/"
}, "detectorApp");

// 🔥 FIREBASE USE
const db = admin.database(detectorApp);
const messaging = admin.messaging(detectorApp);

// 🔥 MEMORY STORE
const ipHits = {};
const alertedIPs = {};
let allowedDomains = [];

// ================== LOAD DOMAINS FROM FIREBASE ==================
async function loadDomains() {
  const snap = await db.ref("domains").once("value");
  const data = snap.val();

  if (data) {
    allowedDomains = Object.values(data);
    console.log("✅ Domains Loaded:", allowedDomains.length);
  }
}

// 🔄 refresh domains every 60 sec
setInterval(loadDomains, 60000);
loadDomains();

// ================== FCM FUNCTION ==================
async function sendFCM(ip, type) {
  try {
    const snapshot = await db.ref("tokens").once("value");
    const tokens = snapshot.val();

    if (!tokens) return;

    for (let key in tokens) {
      const token = tokens[key];

      try {
        await messaging.send({
          token,
          android: { priority: "high" },
          data: { ip: ip, type: type }
        });
      } catch (e) {
        console.log("❌ Token Error:", key);
      }
    }

  } catch (err) {
    console.log("❌ FCM Error:", err.message);
  }
}

// ================== MAIN MIDDLEWARE ==================
app.use(async (req, res, next) => {

  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress;

  const host = req.headers.host || "";

  ipHits[ip] = (ipHits[ip] || 0) + 1;

  console.log("IP:", ip);
  console.log("Host:", host);
  console.log("URL:", req.url);
  console.log("Hits:", ipHits[ip]);

  // ================= DIRECT IP DETECTION =================
 const isValidDomain = allowedDomains.some(d => 
  host === d || host.endsWith("." + d)
);

  if (!isValidDomain) {
    console.log("🚨 DIRECT IP / UNKNOWN DOMAIN:", host);

    await db.ref("alerts").push({
      type: "direct_ip",
      ip,
      host,
      time: Date.now()
    });

    await sendFCM(ip, "direct_ip");

    return res.status(403).send("Forbidden");
  }

  // ================= VISIT ALERT =================
  if (!alertedIPs[ip]) {
    alertedIPs[ip] = true;

    await db.ref("alerts").push({
      type: "visit",
      ip,
      host,
      time: Date.now()
    });

    await sendFCM(ip, "visit");
  }

  // ================= SUSPICIOUS =================
  if (ipHits[ip] > 20 && ipHits[ip] < 25) {
    console.log("🚨 Suspicious IP:", ip);

    await db.ref("alerts").push({
      type: "suspicious",
      ip,
      hits: ipHits[ip],
      url: req.url,
      time: Date.now()
    });

    await sendFCM(ip, "suspicious");
  }

  next();
});

// ================= CLEAN MEMORY =================
setInterval(() => {
  for (let ip in ipHits) {
    if (ipHits[ip] < 5) {
      delete ipHits[ip];
      delete alertedIPs[ip];
    }
  }
}, 60000);

// ================= API =================
app.post("/send", async (req, res) => {

  const { token, data } = req.body;

  if (!token || !data) {
    return res.json({ success: false });
  }

  try {
    await messaging.send({
      token,
      android: { priority: "high" },
      data
    });

    res.json({ success: true });

  } catch (err) {
    res.json({ success: false });
  }
});

// ================= ROOT =================
app.get("/", (req, res) => {
  res.send("🔥 Server running babu 🚀");
});

// ================= START =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🔥 Server running on port " + PORT);
});
