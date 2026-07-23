const express = require('express');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const app = express();
const PORT = 2000;

const SEED_FILE = path.join(__dirname, 'data.json');
const DISK_DIR = process.env.DATA_DIR || '/var/data';
const DATA_DIR = fs.existsSync(DISK_DIR) ? DISK_DIR : __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');

// Primeira execução com disco persistente: semeia o data.json a partir do repositório.
if (DATA_FILE !== SEED_FILE && !fs.existsSync(DATA_FILE)) {
  fs.copyFileSync(SEED_FILE, DATA_FILE);
}

const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

function readData() { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); }
function writeData(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }
function normName(n) { return n.trim().toLowerCase().replace(/\s+/g, ' '); }

/* ─── UPLOAD DE IMAGENS ─── */
const ALLOWED_IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

app.post('/api/upload', (req, res) => {
  const { dataUrl } = req.body;
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match || !ALLOWED_IMAGE_TYPES[match[1]]) {
    return res.status(400).json({ error: 'Imagem inválida. Use PNG, JPG, WEBP ou GIF.' });
  }
  const ext = ALLOWED_IMAGE_TYPES[match[1]];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 8 * 1024 * 1024) {
    return res.status(413).json({ error: 'Imagem muito grande (máx. 8MB).' });
  }
  const filename = `${randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  res.json({ success: true, url: `/uploads/${filename}` });
});

/* ─── EVENTO ─── */
app.get('/api/evento', (req, res) => res.json(readData().evento));

/* ─── GUESTS ─── */
app.get('/api/guests', (req, res) => res.json(readData().guests || []));

app.post('/api/guests', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });
  const data = readData();
  const guest = { id: `g${Date.now()}`, name: name.trim(), group: 'Convidados' };
  data.guests.push(guest);
  writeData(data);
  res.json({ success: true, guest });
});

app.patch('/api/guests/:id', (req, res) => {
  const { name, children } = req.body;
  const data = readData();
  const guest = data.guests.find(g => g.id === req.params.id);
  if (!guest) return res.status(404).json({ error: 'Convidado não encontrado.' });
  if (name !== undefined) guest.name = name.trim();
  if (children !== undefined) guest.children = Math.max(0, parseInt(children) || 0);
  writeData(data);
  res.json({ success: true, guest });
});

app.delete('/api/guests/:id', (req, res) => {
  const data = readData();
  const idx = data.guests.findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Convidado não encontrado.' });
  data.guests.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
});

/* ─── RSVP ─── */
app.get('/api/rsvp', (req, res) => res.json(readData().presences));

app.post('/api/rsvp', (req, res) => {
  const { name, phone, attending, companions, message, guestId } = req.body;
  if (!name || !['yes', 'no'].includes(attending)) {
    return res.status(400).json({ error: 'Nome e confirmação são obrigatórios.' });
  }
  const data = readData();
  if (data.presences.find(p => normName(p.name) === normName(name))) {
    return res.status(409).json({ error: 'Este nome já está registrado.' });
  }
  const onList = guestId ? !!(data.guests || []).find(g => g.id === guestId) : false;
  const cleanCompanions = attending === 'yes'
    ? (companions || []).filter(c => c && c.name && c.name.trim()).map(c => ({ name: c.name.trim() }))
    : [];
  const entry = {
    id: randomUUID(),
    name: name.trim(),
    phone: phone || '',
    attending,
    companions: cleanCompanions,
    message: message || '',
    guestId: guestId || null,
    onList,
    createdAt: new Date().toISOString()
  };
  data.presences.push(entry);
  writeData(data);
  res.json({ success: true, entry });
});

app.delete('/api/rsvp/:id', (req, res) => {
  const data = readData();
  const idx = data.presences.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Confirmação não encontrada.' });
  data.presences.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
});

/* ─── MESSAGES (Mural) ─── */
app.get('/api/messages', (req, res) => res.json(readData().messages || []));

app.post('/api/messages', (req, res) => {
  const { name, text } = req.body;
  if (!name || !text) return res.status(400).json({ error: 'Nome e mensagem são obrigatórios.' });
  const data = readData();
  if (!data.messages) data.messages = [];
  const msg = { id: randomUUID(), name: name.trim(), text: text.trim(), createdAt: new Date().toISOString() };
  data.messages.push(msg);
  writeData(data);
  res.json({ success: true, msg });
});

app.delete('/api/messages/:id', (req, res) => {
  const data = readData();
  if (!data.messages) return res.status(404).json({ error: 'Não encontrado.' });
  const idx = data.messages.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Mensagem não encontrada.' });
  data.messages.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
});

/* ─── PRESENTES (público) ─── */
app.get('/api/presentes', (req, res) => {
  const data = readData();
  res.json({ gifts: data.gifts || [], giftList: data.giftList || [] });
});

/* Reservar um presente */
app.post('/api/presentes/list/:id/reserve', (req, res) => {
  const { personName, chosenLink } = req.body;
  if (!personName) return res.status(400).json({ error: 'Nome é obrigatório.' });
  const data = readData();
  const item = data.giftList.find(g => g.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Presente não encontrado.' });
  const qty = item.quantity || 1;
  if (!item.reservations) item.reservations = [];
  if (item.reservations.length >= qty) {
    return res.status(409).json({ error: 'Este presente já foi reservado.' });
  }
  const reservation = { id: randomUUID(), personName: personName.trim(), chosenLink: (chosenLink || '').trim() || null, createdAt: new Date().toISOString() };
  item.reservations.push(reservation);
  item.takenBy = item.reservations[0]?.personName || null;
  writeData(data);
  res.json({ success: true, item });
});

/* Remover reserva (admin) */
app.delete('/api/presentes/list/:id/reserve/:rid', (req, res) => {
  const data = readData();
  const item = data.giftList.find(g => g.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Presente não encontrado.' });
  if (!item.reservations) item.reservations = [];
  const idx = item.reservations.findIndex(r => r.id === req.params.rid);
  if (idx === -1) return res.status(404).json({ error: 'Reserva não encontrada.' });
  item.reservations.splice(idx, 1);
  item.takenBy = item.reservations[0]?.personName || null;
  writeData(data);
  res.json({ success: true, item });
});

/* Admin: adicionar item */
app.post('/api/presentes/list', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });
  const data = readData();
  const item = {
    id: String(Date.now()),
    name: name.trim(),
    description: req.body.description || '',
    imageUrl: req.body.imageUrl || '',
    emoji: req.body.emoji || '🎁',
    category: req.body.category || 'Geral',
    links: [],
    quantity: 1,
    reservations: [],
    takenBy: null
  };
  data.giftList.push(item);
  writeData(data);
  res.json({ success: true, item });
});

/* Admin: editar item */
app.patch('/api/presentes/list/:id', (req, res) => {
  const { name, links, description, imageUrl, quantity, category, emoji } = req.body;
  const data = readData();
  const item = data.giftList.find(g => g.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item não encontrado.' });
  if (name        !== undefined) item.name        = name.trim();
  if (description !== undefined) item.description = description.trim();
  if (imageUrl    !== undefined) item.imageUrl    = imageUrl.trim();
  if (category    !== undefined) item.category    = category.trim();
  if (emoji       !== undefined) item.emoji       = emoji.trim();
  if (quantity    !== undefined) item.quantity    = Math.max(1, parseInt(quantity) || 1);
  if (links       !== undefined) {
    item.links = links.map(l => ({ url: (l.url||'').trim(), label: (l.label||'').trim(), image: (l.image||'').trim() })).filter(l => l.url);
  }
  if (!item.links) item.links = [];
  if (!item.reservations) item.reservations = [];
  writeData(data);
  res.json({ success: true, item });
});

/* Admin: remover item */
app.delete('/api/presentes/list/:id', (req, res) => {
  const data = readData();
  const idx = data.giftList.findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item não encontrado.' });
  if ((data.giftList[idx].reservations || []).length > 0) {
    return res.status(409).json({ error: 'Presente já reservado, não pode ser removido.' });
  }
  data.giftList.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
});

/* ─── DASHBOARD ─── */
app.get('/api/dashboard', (req, res) => {
  const data = readData();
  const yes   = data.presences.filter(p => p.attending === 'yes');
  const no    = data.presences.filter(p => p.attending === 'no');
  const guests = (data.guests || []).map(g => {
    const presence = data.presences.find(p => p.guestId === g.id);
    return { ...g, status: presence ? presence.attending : null, presenceName: presence ? presence.name : null };
  });
  res.json({
    evento: data.evento,
    totalConfirmed: yes.length,
    totalDeclined: no.length,
    totalGifts: (data.gifts || []).length,
    giftListTotal: data.giftList.length,
    giftListTaken: data.giftList.filter(g => (g.reservations||[]).length >= (g.quantity||1)).length,
    totalMessages: (data.messages || []).length,
    presences: data.presences,
    gifts: data.gifts || [],
    giftList: data.giftList,
    messages: data.messages || [],
    guests,
    totalInvited: guests.length,
    guestsPending: guests.filter(g => !g.status).length
  });
});

app.listen(PORT, () => {
  console.log(`\n Festa da Juliana: http://localhost:${PORT}`);
  console.log(` Dashboard:        http://localhost:${PORT}/dashboard.html\n`);
});
