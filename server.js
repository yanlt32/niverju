const express = require('express');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function normName(n) {
  return n.trim().toLowerCase().replace(/\s+/g, ' ');
}

app.get('/api/evento', (req, res) => res.json(readData().evento));
app.get('/api/rsvp', (req, res) => res.json(readData().presences));

app.post('/api/rsvp', (req, res) => {
  const { name, phone, attending, message } = req.body;
  if (!name || !['yes', 'no', 'maybe'].includes(attending)) {
    return res.status(400).json({ error: 'Nome e confirmação são obrigatórios.' });
  }
  const data = readData();
  if (data.presences.find(p => normName(p.name) === normName(name))) {
    return res.status(409).json({ error: 'Este nome já está registrado. Caso precise atualizar, entre em contato com a organização.' });
  }
  const entry = {
    id: randomUUID(),
    name: name.trim(),
    phone: phone || '',
    attending,
    message: message || '',
    createdAt: new Date().toISOString()
  };
  data.presences.push(entry);
  writeData(data);
  res.json({ success: true, entry });
});

app.get('/api/presentes', (req, res) => {
  const data = readData();
  res.json({ gifts: data.gifts, giftList: data.giftList });
});

app.post('/api/presentes', (req, res) => {
  const { personName, phone, giftId, customGift, message } = req.body;
  if (!personName || (!giftId && !customGift)) {
    return res.status(400).json({ error: 'Nome e presente são obrigatórios.' });
  }
  const data = readData();
  let giftName = customGift;
  let giftEmoji = '🎁';

  if (giftId) {
    const item = data.giftList.find(g => g.id === giftId);
    if (!item) return res.status(404).json({ error: 'Presente não encontrado.' });
    if (item.takenBy) return res.status(409).json({ error: 'Este presente já foi escolhido!' });
    item.takenBy = personName.trim();
    giftName = item.name;
    giftEmoji = item.emoji || '🎁';
  }

  const entry = {
    id: randomUUID(),
    personName: personName.trim(),
    phone: phone || '',
    giftId: giftId || null,
    giftName,
    giftEmoji,
    message: message || '',
    createdAt: new Date().toISOString()
  };
  data.gifts.push(entry);
  writeData(data);
  res.json({ success: true, entry });
});

// Gift list management (admin)
app.post('/api/presentes/list', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });
  const data = readData();
  const item = { id: String(Date.now()), name: name.trim(), emoji: '🎁', links: [], takenBy: null };
  data.giftList.push(item);
  writeData(data);
  res.json({ success: true, item });
});

app.patch('/api/presentes/list/:id', (req, res) => {
  const { name, links } = req.body;
  const data = readData();
  const item = data.giftList.find(g => g.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item não encontrado.' });
  if (name !== undefined) item.name = name.trim();
  if (links !== undefined) {
    item.links = links.map(l => ({
      url: (l.url || '').trim(),
      label: (l.label || '').trim()
    })).filter(l => l.url);
  }
  if (!item.links) item.links = [];
  writeData(data);
  res.json({ success: true, item });
});

app.delete('/api/presentes/list/:id', (req, res) => {
  const data = readData();
  const idx = data.giftList.findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item não encontrado.' });
  if (data.giftList[idx].takenBy) return res.status(409).json({ error: 'Presente já reservado, não pode ser removido.' });
  data.giftList.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
});

app.get('/api/dashboard', (req, res) => {
  const data = readData();
  const yes = data.presences.filter(p => p.attending === 'yes');
  const no = data.presences.filter(p => p.attending === 'no');
  const maybe = data.presences.filter(p => p.attending === 'maybe');
  res.json({
    evento: data.evento,
    totalConfirmed: yes.length,
    totalDeclined: no.length,
    totalMaybe: maybe.length,
    totalGuests: yes.length,
    totalGifts: data.gifts.length,
    giftListTotal: data.giftList.length,
    giftListTaken: data.giftList.filter(g => g.takenBy).length,
    presences: data.presences,
    gifts: data.gifts,
    giftList: data.giftList
  });
});

app.listen(PORT, () => {
  console.log(`\n Festa da Juliana: http://localhost:${PORT}`);
  console.log(` Dashboard:        http://localhost:${PORT}/dashboard.html\n`);
});
