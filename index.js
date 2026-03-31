const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

// 🔥 PROXY FIX
app.set("trust proxy", true);

// 🔥 LOAD BOTH JSON
const adminJson = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); // admin app
const detectorJson = JSON.parse(process.env.SERVICE_ACCOUNT); // ip detector

// 🔥 INIT ADMIN APP (old wala — SMS/call)
const adminApp = admin.initializeApp({
  credential: admin.credential.cert(adminJson)
}, "adminApp");

// 🔥 INIT IP DETECTOR APP (main wala)
const detectorApp = admin.initializeApp({
  credential: admin.credential.cert(detectorJson),
  databaseURL: "https://ip-detector-6a30f-default-rtdb.firebaseio.com/"
}, "detectorApp");

// 🔥 USE DETECTOR PROJECT
const db = admin.database(detectorApp);
const messaging = admin.messaging(detectorApp);

// 🔥 IP TRACK SYSTEM
const ipHits = {};
const alertedIPs = {};

// 🔥 FCM SEND FUNCTION
async function sendFCM(ip, type) {
  try {
    const snapshot = await db.ref("tokens").once("value");
    const tokens = snapshot.val();

    if (!tokens) {
      console.log("❌ No tokens found");
      return;
    }

    for (let key in tokens) {
      const token = tokens[key];

      try {
        await messaging.send({
          token: token,
          android: {
            priority: "high"
          },
          data: {
            ip: ip,
            type: type
          }
        });

        console.log("✅ FCM sent to:", key);

      } catch (e) {
        console.log("❌ Error sending to", key, e.message);
      }
    }

  } catch (err) {
    console.log("❌ FCM main error:", err.message);
  }
}

// 🔥 MAIN MIDDLEWARE
app.use(async (req, res, next) => {

  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress;

  ipHits[ip] = (ipHits[ip] || 0) + 1;

  console.log("IP:", ip);
  console.log("URL:", req.url);
  console.log("Hits:", ipHits[ip]);

  // 🔥 VISIT ALERT
  if (!alertedIPs[ip]) {
    alertedIPs[ip] = true;

    await db.ref("alerts").push({
      type: "visit",
      ip: ip,
      time: Date.now()
    });

    await sendFCM(ip, "visit");
  }

  // 🚨 SUSPICIOUS ALERT
  if (ipHits[ip] > 20 && ipHits[ip] < 25) {

    console.log("🚨 Suspicious IP:", ip);

    await db.ref("alerts").push({
      type: "suspicious",
      ip: ip,
      hits: ipHits[ip],
      url: req.url,
      time: Date.now()
    });

    await sendFCM(ip, "suspicious");
  }

  console.log("----------------------");

  next();
});

// 🔥 MEMORY CLEANUP
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
    return res.json({ success: false, msg: "Invalid request" });
  }

  try {
    await messaging.send({
      token: token,
      android: {
        priority: "high"
      },
      data: data
    });

    console.log("✅ Manual FCM sent");
    res.json({ success: true });

  } catch (err) {
    console.log("❌ Error:", err.message);
    res.json({ success: false });
  }
});

// 🔥 ROOT
app.get("/", (req, res) => {
  res.send("Server running babu 🚀");
});

// 🔥 PORT
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🔥 Server running on port " + PORT);
});
