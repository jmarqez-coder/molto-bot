// bot.js - MoltoBello bot (WhatsApp -> Google Sheets)
// Requisitos: env vars (ver .env.sample)
require('dotenv').config();
const fs = require('fs');
const { Client } = require('whatsapp-web.js');
const { google } = require('googleapis');
const dayjs = require('dayjs');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

// ----------------- Config desde env -----------------
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SERVICE_ACCOUNT_JSON_BASE64 = process.env.SERVICE_ACCOUNT_JSON;
const SESSION_BASE64 = process.env.SESSION_BASE64 || '';
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || '6677770248'; // tu nuevo número

// ----------------- Google Sheets -----------------
if (!SERVICE_ACCOUNT_JSON_BASE64) {
  console.error('ERROR: falta SERVICE_ACCOUNT_JSON env (base64).');
  process.exit(1);
}
const serviceAccountJson = JSON.parse(Buffer.from(SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf8'));
const auth = new google.auth.JWT({
  email: serviceAccountJson.client_email,
  key: serviceAccountJson.private_key,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
  ]
});
const sheets = google.sheets({ version: 'v4', auth });

// ----------------- Helper functions -----------------
async function readSheetValues(range) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  return res.data.values || [];
}
async function appendRow(sheetName, row) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] }
  });
}
async function updateRowRange(sheetName, rangeA1, values2d) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${rangeA1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: values2d }
  });
}
async function findSheetByPrefix(prefix) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const names = meta.data.sheets.map(s => s.properties.title);
  return names.find(n => n.toUpperCase().startsWith(prefix.toUpperCase())) || null;
}

// ----------------- WhatsApp Client -----------------
let session = undefined;
if (SESSION_BASE64) {
  try {
    session = JSON.parse(Buffer.from(SESSION_BASE64, 'base64').toString('utf8'));
    console.log('Session loaded from env (base64).');
  } catch (e) {
    console.warn('No se pudo parsear SESSION_BASE64:', e.message);
  }
}

const client = new Client({
  puppeteer: { headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] },
  session
});

// Guardar el último QR generado en memoria
let lastQR = null;

client.on('qr', qr => {
  qrcodeTerminal.generate(qr, { small: true });
  lastQR = qr;
  console.log('QR actualizado, escanea con WhatsApp.');
});

// ----------------- Express server para QR -----------------
app.get('/qr', async (req, res) => {
  if (!lastQR) return res.status(404).send('QR aún no generado. Refresca después de unos segundos.');
  try {
    const dataUrl = await qrcode.toDataURL(lastQR);
    const img = Buffer.from(dataUrl.split(',')[1], 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': img.length
    });
    res.end(img);
  } catch (e) {
    res.status(500).send('Error generando QR');
  }
});

app.listen(PORT, () => console.log(`Server corriendo en puerto ${PORT}`));

// ----------------- Inicializar WhatsApp -----------------
client.on('authenticated', () => {
  console.log('WhatsApp autenticado, guarda session.json si necesitas.');
});

client.on('ready', () => {
  console.log('✅ Bot conectado a WhatsApp y listo.');
});

client.initialize();
