require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const app = express();
const PORT = process.env.PORT || 3000;
const POSTS_FILE = path.join(__dirname, 'posts.json');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helper: slug generation
function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ----------- IMAGE UPLOAD -----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });
app.post('/api/upload', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: `/uploads/${req.file.filename}` });
});
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ----------- AUTH ROUTE -----------
app.post('/api/login', async (req, res) => {
  try {
     console.log('Login attempt:', req.body);
  console.log('ENV:', process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD, process.env.JWT_SECRET);
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (username !== process.env.ADMIN_USERNAME) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, process.env.ADMIN_PASSWORD);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ----------- POSTS ROUTES -----------
app.get('/api/posts', (req, res) => {
  fs.readFile(POSTS_FILE, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Cannot read posts' });
    try {
      res.json(JSON.parse(data));
    } catch {
      res.status(500).json({ error: 'Invalid posts data' });
    }
  });
});


app.get('/api/post/:identifier', (req, res) => {
  const identifier = req.params.identifier;
  fs.readFile(POSTS_FILE, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Cannot read posts' });
    try {
      const posts = JSON.parse(data);
      let post = null;
      if (!isNaN(identifier)) post = posts.find(p => p.id === parseInt(identifier));
      if (!post) post = posts.find(p => p.slug === identifier);
      if (!post) post = posts.find(p => generateSlug(p.title) === identifier);
      if (!post) return res.status(404).json({ error: 'Post not found' });
      res.json(post);
    } catch {
      res.status(500).json({ error: 'Invalid posts data' });
    }
  });
});

// Auth middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
  const token = authHeader.split(' ')[1];
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
}

// Create post
app.post('/api/posts', authMiddleware, upload.single('image'), (req, res) => {
  const { title, content, label } = req.body;
  if (!title || !content || !label) {
    return res.status(400).json({ error: 'Title, content, and label required' });
  }

  fs.readFile(POSTS_FILE, 'utf8', (err, data) => {
    let posts = [];
    if (!err) {
      try { posts = JSON.parse(data); } catch {}
    }

    const newPost = {
      id: Date.now(),
      title,
      content,
      label,
      slug: generateSlug(title),
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      createdAt: new Date().toISOString(),
image: req.file ? `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}` : null
    };

    posts.push(newPost);

    fs.writeFile(POSTS_FILE, JSON.stringify(posts, null, 2), writeErr => {
      if (writeErr) return res.status(500).json({ error: 'Cannot save post' });
      res.json({ success: true, id: newPost.id, slug: newPost.slug });
    });
  });
});



app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));

// Update post
app.put('/api/posts/:id', authMiddleware, (req, res) => {
  const postId = parseInt(req.params.id);
  const { title, content, label } = req.body;
  if (!title || !content || !label) return res.status(400).json({ error: 'Title, content, and label required' });

  fs.readFile(POSTS_FILE, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Cannot read posts' });
    let posts = [];
    try { posts = JSON.parse(data); } catch { return res.status(500).json({ error: 'Invalid posts data' }); }

    const index = posts.findIndex(p => p.id === postId);
    if (index === -1) return res.status(404).json({ error: 'Post not found' });

    posts[index] = { ...posts[index], title, content, label, slug: generateSlug(title), updated: new Date().toISOString() };
    fs.writeFile(POSTS_FILE, JSON.stringify(posts, null, 2), writeErr => {
      if (writeErr) return res.status(500).json({ error: 'Cannot save post' });
      res.json({ success: true });
    });
  });
});

// Delete post
app.delete('/api/posts/:id', authMiddleware, (req, res) => {
  const postId = parseInt(req.params.id);
  fs.readFile(POSTS_FILE, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Cannot read posts' });
    let posts = [];
    try { posts = JSON.parse(data); } catch { return res.status(500).json({ error: 'Invalid posts data' }); }

    const index = posts.findIndex(p => p.id === postId);
    if (index === -1) return res.status(404).json({ error: 'Post not found' });

    const deletedPost = posts.splice(index, 1)[0];
    fs.writeFile(POSTS_FILE, JSON.stringify(posts, null, 2), writeErr => {
      if (writeErr) return res.status(500).json({ error: 'Cannot save posts' });
      res.json({ success: true, post: deletedPost });
    });
  });
});



// ----------- STATIC FILES -----------
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static('build'));

// ----------- START SERVER -----------
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);

  if (!fs.existsSync(POSTS_FILE)) fs.writeFileSync(POSTS_FILE, JSON.stringify([], null, 2));
  if (!fs.existsSync(path.join(__dirname, 'uploads'))) fs.mkdirSync(path.join(__dirname, 'uploads'));
});
