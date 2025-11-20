// server.js
// Minimal Express + MongoDB GridFS streaming backend
// Install: npm i express mongoose multer cors dotenv
// Run: node server.js (ensure MONGO_URI set in .env)

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const { Readable } = require('stream');
const cors = require('cors');
const { ObjectId } = require('mongodb');
const twilio = require("twilio");

const app = express();
app.use(cors());
app.use(express.json());

const mongoUri = process.env.MONGO_URI ;
const port = process.env.PORT ;

mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
const conn = mongoose.connection;

let gfsBucket;
conn.once('open', () => {
  gfsBucket = new mongoose.mongo.GridFSBucket(conn.db, { bucketName: 'uploads' });
  console.log('Connected to MongoDB and GridFSBucket ready.');
});

// multer memory storage (no disk)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Upload endpoint: streams file buffer into GridFS
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const readable = new Readable();
    readable.push(req.file.buffer);
    readable.push(null); // end

    const metadata = {
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadedAt: new Date()
    };

    const uploadStream = gfsBucket.openUploadStream(req.file.originalname, {
      contentType: req.file.mimetype,
      metadata
    });

    readable.pipe(uploadStream)
      .on('error', (err) => res.status(500).json({ error: err.message }))
      .on('finish', () => {
        return res.json({
          fileId: uploadStream.id,
          filename: uploadStream.filename,
          message: 'Uploaded'
        });
      });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// List files metadata
app.get('/files', async (req, res) => {
  try {
    const files = await conn.db.collection('uploads.files').find().sort({ 'uploadDate': -1 }).toArray();
    const list = files.map(f => ({
      id: f._id,
      filename: f.filename,
      contentType: f.contentType,
      length: f.length,
      uploadDate: f.uploadDate,
      metadata: f.metadata
    }));
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stream / view / download a file
// ?download=true will set Content-Disposition=attachment
app.get('/files/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).send('Invalid id');

    const _id = new ObjectId(id);
    const filesCol = conn.db.collection('uploads.files');
    const fileDoc = await filesCol.findOne({ _id });
    if (!fileDoc) return res.status(404).send('File not found');

    res.setHeader('Content-Type', fileDoc.contentType || 'application/octet-stream');
    if (req.query.download === 'true') {
      res.setHeader('Content-Disposition', `attachment; filename="${fileDoc.filename}"`);
    } else {
      // For inline viewing, set inline disposition for common types
      res.setHeader('Content-Disposition', 'inline');
    }

    const downloadStream = gfsBucket.openDownloadStream(_id);
    downloadStream.on('error', () => res.sendStatus(404));
    downloadStream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete file
app.delete('/files/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).send('Invalid id');
    await gfsBucket.delete(new ObjectId(id));
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Share: returns public URL (in real app you might generate signed URL or short code)
app.get('/share/:id', (req, res) => {
  const id = req.params.id;
  // Example: front-end is expected at process.env.CLIENT_ORIGIN or the user will paste link
  const origin = process.env.CLIENT_ORIGIN || `http://localhost:3000`;
  const shareUrl = `${origin}/preview/${id}`; // frontend route to show preview
  res.json({ shareUrl });
});











mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .then(() => console.log("MongoDB Connected for login "))
  .catch((err) => console.error(err));

// 2️⃣ Define Schema in same file
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },  // ✅ Must exist
    phone: { type: String, required: true },
    email: { type: String, required: true },
    password: { type: String, required: true },
    mpin: { type: String, required: true }
});

const User = mongoose.model("User", userSchema);


// 4️⃣ Route to Save Registration + MPIN
app.post("/api/register-full", async (req, res) => {
  try {
    const { name, phone, email, password, mpin } = req.body;

    const newUser = new User({ name, phone, email, password, mpin });
    await newUser.save();

    res.json({ message: "User registered successfully", name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 Login with Email OR Phone + MPIN
app.post("/api/login-mpin", async (req, res) => {
  try {
    const { phoneOrEmail, mpin } = req.body; // ✅ updated key name

    // Find user by phone OR email + MPIN
    const user = await User.findOne(
      { 
        $or: [
          { phone: phoneOrEmail }, 
          { email: phoneOrEmail }
        ], 
        mpin 
      },
      { name: 1, phone: 1, email: 1, mpin: 1 } // only select needed fields
    );

    if (!user) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    res.json({
      success: true,
      message: "Login successful",
      name: user.name,
      phone: user.phone,
      email: user.email
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post('/notes', async (req, res) => {
  try {
    const note = new Note({ text: req.body.text });
    await note.save();
    res.json(note);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save note' });
  }
});

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log("MongoDB connected for Notes"))
  .catch(err => console.error(err));

// Note Schema
const noteSchema = new mongoose.Schema({
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Note = mongoose.model('Note', noteSchema);

// Get all notes
app.get('/notes', async (req, res) => {
  const notes = await Note.find().sort({ createdAt: -1 });
  res.json(notes);
});

// Add new note
app.post('/notes', async (req, res) => {
  try {
    const note = new Note({ text: req.body.text });
    await note.save();
    res.json(note);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// Update note
app.put('/notes/:id', async (req, res) => {
  try {
    const updated = await Note.findByIdAndUpdate(
      req.params.id,
      { text: req.body.text },
      { new: true }
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// Delete note
app.delete('/notes/:id', async (req, res) => {
  try {
    await Note.findByIdAndDelete(req.params.id);
    res.sendStatus(200);
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete note' });
  }
});





// Example Node.js / Express snippet
app.post('/sync-contacts', async (req, res) => {
  const { token } = req.body;

  try {
    const response = await fetch(
      'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers&pageSize=100',
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    const data = await response.json();
    res.json({ contacts: data.connections || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});












app.listen(process.env.PORT,  () => {
  console.log(`🚀 Server running at http://localhost:${process.env.PORT}`);
});