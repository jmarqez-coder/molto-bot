// bot.js - MoltoBello bot (WhatsApp -> Google Sheets)
// Requisitos: env vars (ver .env.sample)
// Usa: whatsapp-web.js + Google Service Account (googleapis)
require('dotenv').config();
const fs = require('fs');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode');
const { Client } = require('whatsapp-web.js');
const { google } = require('googleapis');
const dayjs = require('dayjs');

// ----------------- Config desde env -----------------
const SPREADSHEET_ID = process.env.SPREADSHEET_ID; // id de tu Google Sheet
const SERVICE_ACCOUNT_JSON_BASE64 = process.env.SERVICE_ACCOUNT_JSON; // base64 del JSON de la service account
const SESSION_BASE64 = process.env.SESSION_BASE64 || ''; // base64 del session.json (opcional)
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || '6677770248'; // nuevo número
const PORT = process.env.PORT || 10000;

// ----------------- Inicializar Google Sheets client -----------------
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

// ----------------- Helper: read/append/update sheet -----------------
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

// ----------------- Inicializar WhatsApp -----------------
let session = undefined;
if (SESSION_BASE64) {
  try {
    const sessionJson = Buffer.from(SESSION_BASE64, 'base64').toString('utf8');
    session = JSON.parse(sessionJson);
    console.log('Session loaded from env (base64).');
  } catch (e) {
    console.warn('No se pudo parsear SESSION_BASE64:', e.message);
  }
}

const client = new Client({
  puppeteer: { headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] },
  session
});

// ----------------- Generar QR -----------------
client.on('qr', qr => {
  console.log('Escanea este QR con tu WhatsApp:');
  qrcodeTerminal.generate(qr, { small: true });
  // además guardamos imagen para escanear mejor
  qrcode.toFile('qr.png', qr, function (err) {
    if (err) throw err;
    console.log('QR guardado como qr.png');
  });
});

client.on('authenticated', (sessionData) => {
  console.log('WhatsApp autenticado, guarda session.json si necesitas.');
});

client.on('ready', () => {
  console.log('✅ Bot conectado a WhatsApp y listo.');
});

// ----------------- Escuchar mensajes -----------------
client.on('message', async msg => {
  console.log('Mensaje recibido del número:', msg.from, '→', msg.body); // depuración

  try {
    const raw = msg.body.trim();
    if (!raw) return;
    const tokens = raw.split(/\s+/);
    const cmd = tokens[0].toLowerCase();

    if (cmd === 'venta') {
      const reply = await handleVentaCommand(tokens);
      msg.reply(reply);
    } else if (cmd === 'gastos') {
      const reply = await handleGastosCommand(tokens);
      msg.reply(reply);
    } else if (cmd === 'facturado') {
      const reply = await handleEgresoCommand(tokens, 'facturado');
      msg.reply(reply);
    } else if (cmd === 'sin' && tokens[1] && tokens[1].toLowerCase() === 'facturar') {
      const tail = tokens.slice(2);
      const reply = await handleEgresoCommand(tail, 'sin facturar');
      msg.reply(reply);
    }
  } catch (e) {
    console.error('Error procesando mensaje:', e);
    try { msg.reply('❌ Error interno al procesar.'); } catch(e) {}
  }
});

// ----------------- Deploy -----------------
(async () => {
  try {
    await auth.authorize();
    console.log('Google Sheets auth OK.');
  } catch (e) {
    console.error('Error autorizando Google Sheets:', e);
    process.exit(1);
  }
  client.initialize();
})();

// ----------------- Servidor healthcheck -----------------
const express = require('express');
const app = express();
app.get('/', (req,res) => res.send('MoltoBello bot running\n'));
app.listen(PORT, () => console.log(`Server on ${PORT}`));

// ----------------- Aquí van tus funciones handleVentaCommand, handleGastosCommand, handleEgresoCommand, monthSheetName, etc. -----------------
