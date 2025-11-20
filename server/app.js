require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const { Readable } = require("stream");
const cors = require("cors");
const { ObjectId } = require("mongodb");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());

const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET;

// ------------------ DATABASE CONNECTION ------------------

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("🔥 MongoDB Connected"))
  .catch((err) => console.error("Mongo error:", err));

const conn = mongoose.connection;

let gfsBucket;
conn.once("open", () => {
  gfsBucket = new mongoose.mongo.GridFSBucket(conn.db, { bucketName: "uploads" });
  console.log("📦 GridFS Bucket ready");
});

// ------------------ GRIDFS UPLOAD ------------------

const storage = multer.memoryStorage();
const upload = multer({ storage });

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file provided" });

    const readable = new Readable();
    readable.push(req.file.buffer);
    readable.push(null);

    const uploadStream = gfsBucket.openUploadStream(req.file.originalname, {
      contentType: req.file.mimetype,
      metadata: {
        originalName: req.file.originalname,
        uploadedAt: new Date(),
      },
    });

    readable.pipe(uploadStream)
      .on("error", (err) => res.status(500).json({ error: err.message }))
      .on("finish", () => {
        res.json({
          fileId: uploadStream.id,
          filename: uploadStream.filename,
        });
      });
  } catch (err) {
    res.status(500).json({ error: "Upload failed" });
  }
});

// ------------------ USER MODEL ------------------

const userSchema = new mongoose.Schema({
  name: String,
  phone: String,
  email: String,
  passwordHash: String,
  mpinHash: String,
});

const User = mongoose.model("User", userSchema);

// ------------------ AUTH MIDDLEWARE ------------------

function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// ------------------ REGISTER ------------------

app.post("/api/register-full", async (req, res) => {
  try {
    const { name, phone, email, password, mpin } = req.body;

    const exists = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { phone }],
    });

    if (exists)
      return res.status(409).json({ error: "Email or phone already registered" });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const mpinHash = await bcrypt.hash(mpin, SALT_ROUNDS);

    const user = new User({ name, phone, email, passwordHash, mpinHash });
    await user.save();

    res.json({ success: true, message: "User registered", user: { name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------ LOGIN WITH MPIN ------------------

app.post("/api/login-mpin", async (req, res) => {
  try {
    const { phoneOrEmail, mpin } = req.body;

    const user = await User.findOne({
      $or: [
        { email: phoneOrEmail.toLowerCase() },
        { phone: phoneOrEmail },
      ],
    });

    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const mpinMatch = await bcrypt.compare(mpin, user.mpinHash);
    if (!mpinMatch)
      return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { id: user._id, email: user.email, phone: user.phone },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        name: user.name,
        email: user.email,
        phone: user.phone,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------ PROTECTED ROUTE EXAMPLE ------------------

app.get("/api/me", auth, (req, res) => {
  res.json({ success: true, user: req.user });
});

// ------------------ START SERVER ------------------

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
