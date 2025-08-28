// server.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// Only load .env locally
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}



const app = express();

app.use(cors({
  origin: "https://renovar-ambientes.vercel.app", 
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Helper: slug
function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Multer memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Initialize Supabase client safely at runtime
function supabaseClient() {
  console.log('Supabase URL:', !!process.env.SUPABASE_URL, 'Service Role:', !!process.env.SUPABASE_SERVICE_ROLE);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE not set');
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
}

/* ================= ROUTES ================= */

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (username !== process.env.ADMIN_USERNAME) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, process.env.ADMIN_PASSWORD);
    if (!valid) {
      console.log('Login attempt:', username);
      console.log('Password valid:', await bcrypt.compare(password, process.env.ADMIN_PASSWORD));
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Upload image
app.post('/api/upload', authMiddleware, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const supabase = supabaseClient();
  const filename = `${Date.now()}-${req.file.originalname}`;
  const { error } = await supabase.storage.from('uploads').upload(filename, req.file.buffer, {
    contentType: req.file.mimetype,
  });

  if (error) return res.status(500).json({ error: error.message });

  const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(filename);
  res.json({ url: publicUrl });
});

// Get all posts
app.get('/api/posts', async (req, res) => {
  const supabase = supabaseClient();
  const { data, error } = await supabase.from('posts').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Get single post by id or slug
app.get('/api/post/:identifier', async (req, res) => {
  const supabase = supabaseClient();
  const identifier = req.params.identifier;
  let query;

  if (!isNaN(identifier)) {
    query = supabase.from('posts').select('*').eq('id', identifier).single();
  } else {
    query = supabase.from('posts').select('*').eq('slug', identifier).single();
  }

  const { data, error } = await query;
  if (error || !data) return res.status(404).json({ error: 'Post not found' });
  res.json(data);
});

// Create post
app.post('/api/posts', authMiddleware, async (req, res) => {
  const { title, content, label, image } = req.body;
  if (!title || !content || !label)
    return res.status(400).json({ error: 'Missing fields' });

  const slug = generateSlug(title) + '-' + Date.now();

  const supabase = supabaseClient();
  const { data, error } = await supabase.from('posts').insert([
    { title, content, label, slug, image: image || null }
  ]).select();

  if (error) return res.status(500).json({ error: error.message });

  res.json(data[0]);
});

// --- Update post ---
// --- Update post ---
app.put('/api/posts/:id', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const supabase = supabaseClient(); // <--- important

    const postId = req.params.id;
    const { title, content, label, imagePosition } = req.body;
    let image = req.body.image; // fallback if not uploading

    // Use uploaded file if present
    if (req.file) {
      const filename = `${Date.now()}-${req.file.originalname}`;
      const { error: uploadError } = await supabase.storage.from('uploads').upload(filename, req.file.buffer, {
        contentType: req.file.mimetype,
      });
      if (uploadError) return res.status(500).json({ error: uploadError.message });

      const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(filename);
      image = publicUrl;
    }

    const slug = title
      ? title.toLowerCase()
             .replace(/[^a-z0-9 -]/g, '')
             .replace(/\s+/g, '-')
             .replace(/-+/g, '-')
             .replace(/^-+|-+$/g, '')
      : undefined;

    const updateData = {
      ...(title && { title }),
      ...(content && { content }),
      ...(label && { label }),
      ...(slug && { slug }),
      ...(image && { image }),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from('posts').update(updateData).eq('id', postId).select();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, post: data[0] });
  } catch (err) {
    console.error("PUT /api/posts/:id error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// Delete post
app.delete('/api/posts/:id', authMiddleware, async (req, res) => {
  const postId = req.params.id;
  const supabase = supabaseClient();

  const { data, error } = await supabase.from('posts').delete().eq('id', postId).select();
  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true, post: data[0] });
});

/* ================= EXPORT FOR VERCEL ================= */
module.exports = app;
