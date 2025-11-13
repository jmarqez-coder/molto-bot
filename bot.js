// bot.js - MoltoBello bot (WhatsApp -> Google Sheets)
// Versión actualizada: sirve /qr.png y /qr HTML dinámicamente, con logs de depuración.
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
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || '6677770248';

// ----------------- Google Sheets (igual que antes) -----------------
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

// ----------------- Helpers Google Sheets (resumidos) -----------------
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

// ----------------- WhatsApp client -----------------
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

// guardamos el último QR (string) en memoria y el timestamp
let lastQR = null;
let lastQRTimestamp = 0;

client.on('qr', qr => {
  // qr es el string que whatsapp-web.js emite
  lastQR = qr;
  lastQRTimestamp = Date.now();
  console.log('QR actualizado en memoria (timestamp):', new Date(lastQRTimestamp).toISOString());
  // muestra ASCII en logs (útil)
  qrcodeTerminal.generate(qr, { small: true });
});

// Autenticación / ready
client.on('authenticated', () => console.log('WhatsApp autenticado.'));
client.on('auth_failure', msg => console.error('Auth failure:', msg));
client.on('ready', () => console.log('✅ Bot conectado a WhatsApp y listo.'));

// ----------------- Rutas Express para QR -----------------
// /qr.png -> devuelve la imagen PNG del último QR (si existe)
app.get('/qr.png', async (req, res) => {
  try {
    if (!lastQR) {
      return res.status(404).send('QR aún no generado. Refresca la página dentro de unos segundos.');
    }
    // Generar buffer PNG (rápido y sin DataURL)
    const buffer = await qrcode.toBuffer(lastQR, { type: 'png', margin: 1, width: 300 });
    res.setHeader('Content-Type', 'image/png');
    // evitar cache para que siempre pida nuevo
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.status(200).send(buffer);
  } catch (e) {
    console.error('Error generando qr.png:', e);
    return res.status(500).send('Error generando QR');
  }
});

// /qr -> página HTML que muestra la imagen y se refresca cada 5s
app.get('/qr', (req, res) => {
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>QR MoltoBello</title>
      <style>body{display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:Arial} .box{text-align:center}</style>
    </head>
    <body>
      <div class="box">
        <h3>QR MoltoBello</h3>
        <p id="info">Último QR: ${ lastQRTimestamp ? new Date(lastQRTimestamp).toLocaleTimeString() : 'no generado aún' }</p>
        <img id="qrimg" src="/qr.png?ts=${Date.now()}" alt="QR" />
        <p>La página se refresca automáticamente cada 5s. Si el QR expira, espera a que aparezca "QR actualizado" en los logs y vuelve a cargar.</p>
      </div>
      <script>
        setInterval(() => {
          const img = document.getElementById('qrimg');
          img.src = '/qr.png?ts=' + Date.now();
          document.getElementById('info').innerText = 'Último intento: ' + new Date().toLocaleTimeString();
        }, 5000);
      </script>
    </body>
  </html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// Root healthcheck
app.get('/', (req, res) => res.send('MoltoBello bot running\n'));

// ----------------- Mensajes: agrego log para debug y funciones mínimas -----------------
client.on('message', async msg => {
  console.log('Mensaje recibido de:', msg.from, '→', msg.body);
  try {
    const raw = (msg.body || '').trim();
    if (!raw) return;
    const tokens = raw.split(/\s+/);
    const cmd = tokens[0].toLowerCase();

    if (cmd === 'venta') {
      // placeholder: puedes pegar tu función completa aquí
      msg.reply('✅ Prueba: recibí comando VENTA (bot en modo prueba)');
    } else if (cmd === 'gastos') {
      msg.reply('✅ Prueba: recibí comando GASTOS (bot en modo prueba)');
    } else if (cmd === 'facturado') {
      msg.reply('✅ Prueba: recibí comando FACTURADO (bot en modo prueba)');
    } else if (cmd === 'sin' && tokens[1] && tokens[1].toLowerCase() === 'facturar') {
      msg.reply('✅ Prueba: recibí comando SIN FACTURAR (bot en modo prueba)');
    } else {
      // ignorar otros mensajes
    }
  } catch (e) {
    console.error('Error al procesar mensaje:', e);
    try { msg.reply('❌ Error interno'); } catch(e) {}
  }
});

// ----------------- Inicialización -----------------
(async () => {
  try {
    await auth.authorize();
    console.log('Google Sheets auth OK.');
  } catch (e) {
    console.error('Error autorizando Google Sheets:', e);
    // no hacemos exit para que puedas depurar el QR; si quieres que falle, descomenta:
    // process.exit(1);
  }
  client.initialize();
})();

// start server
app.listen(PORT, () => console.log(`Server corriendo en puerto ${PORT}`));
