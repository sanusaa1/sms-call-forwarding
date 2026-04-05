const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

// 🔥 ENV se load hoga (Railway variable)
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// ================= API =================
app.post("/send", async (req, res) => {

  const { token, data } = req.body;

  if (!token || !data) {
    return res.json({ success: false, msg: "Invalid request" });
  }

  const message = {
    token: token,
    data: data
  };

  try {
    const response = await admin.messaging().send(message);
    console.log("FCM Sent:", response);

    res.json({ success: true });

  } catch (err) {
    console.error("FCM Error:", err);
    res.json({ success: false, error: err.message });
  }
});

// 🔥 Railway ke liye dynamic port
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
