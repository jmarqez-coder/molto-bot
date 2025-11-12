// bot.js - MoltoBello bot (WhatsApp -> Google Sheets)
// Requisitos: env vars (ver .env.sample)
// Usa: whatsapp-web.js + Google Service Account (googleapis)
require('dotenv').config();
const fs = require('fs');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode'); // <-- agregado para guardar imagen
const { Client } = require('whatsapp-web.js');
const { google } = require('googleapis');
const dayjs = require('dayjs');

// ----------------- Config desde env -----------------
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SERVICE_ACCOUNT_JSON_BASE64 = process.env.SERVICE_ACCOUNT_JSON;
const SESSION_BASE64 = process.env.SESSION_BASE64 || '';
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || '';
const PORT = process.env.PORT || 10000;

// Sheet names patterns
function monthSheetName(date = new Date()){
  const months = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}
function gastosSheetName(){
  const m = monthSheetName().split(' ')[0].substr(0,3).toUpperCase();
  const yy = String(new Date().getFullYear()).slice(2);
  return `GASTOS ${m} ${yy}`;
}
function ingEgrSheetPrefix(){
  return 'ING-EGR';
}

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

// ----------------- Helper: read sheet values -----------------
async function readSheetValues(range) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range
  });
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

// ----------------- Lógica para comandos -----------------
async function handleVentaCommand(tokens) {
  const sheetName = monthSheetName();
  const all = await readSheetValues(`${sheetName}!A1:L10000`);
  const headers = all[0] || [];
  const rows = all.slice(1);

  const client = tokens[1] || 'SIN NOMBRE';
  const stopKeys = ['fecha','pago','venta','anticipo'];
  let descParts = [];
  for (let i = 2; i < tokens.length; i++){
    if (stopKeys.includes(tokens[i].toLowerCase())) break;
    descParts.push(tokens[i]);
  }
  const description = descParts.join(' ');

  let fechaEstim = '';
  const idxFecha = tokens.map(t=>t.toLowerCase()).indexOf('fecha');
  if (idxFecha >=0 && tokens[idxFecha+1]) fechaEstim = tokens[idxFecha+1];

  const findNumberAfter = (keyword) => {
    const idx = tokens.map(t=>t.toLowerCase()).indexOf(keyword);
    if (idx >=0 && tokens[idx+1]) {
      const n = parseFloat(tokens[idx+1].replace(/[^0-9.-]/g,''));
      return isNaN(n) ? '' : n;
    }
    return '';
  };
  const pago = findNumberAfter('pago') || '';
  const ventaVal = findNumberAfter('venta') || '';
  const anticipo = findNumberAfter('anticipo') || '';

  const now = dayjs().format('DD/MM/YYYY');

  let foundRowIndex = -1;
  for (let i=0;i<rows.length;i++){
    const r = rows[i];
    const clienteVal = (r[2] || '').toString().trim().toLowerCase();
    const descVal = (r[5] || '').toString().trim().toLowerCase();
    if (clienteVal === client.toLowerCase() && description !== '' && descVal === description.toLowerCase()) {
      foundRowIndex = i;
      break;
    }
  }

  if (foundRowIndex >= 0) {
    const sheetRowNumber = foundRowIndex + 2;
    const colIndex = 11;
    const toColumnLetter = (n) => {
      let s = '';
      while (n>0){
        let m = (n-1)%26;
        s = String.fromCharCode(65+m) + s;
        n = Math.floor((n-1)/26);
      }
      return s;
    };
    const letter = toColumnLetter(colIndex);
    const rangeA1 = `${letter}${sheetRowNumber}:${letter}${sheetRowNumber}`;
    await updateRowRange(sheetName, rangeA1, [[anticipo !== '' ? anticipo : '']]);
    return `✅ Anticipo actualizado para ${client}.`;
  } else {
    const newRow = [
      '', now, client, '', '', description, fechaEstim,
      pago !== '' ? pago : '',
      ventaVal !== '' ? ventaVal : '',
      '', anticipo !== '' ? anticipo : '', ''
    ];
    await appendRow(sheetName, newRow);
    return `✅ Venta registrada: ${client} - ${description}`;
  }
}

// Gastos
async function handleGastosCommand(tokens) {
  const sheetName = (await findSheetByPrefix('GASTOS')) || gastosSheetName();
  const amount = parseFloat(tokens[1].replace(/[^0-9.-]/g,'')) || '';
  const concept = tokens.slice(2).join(' ') || '';
  const now = dayjs().format('DD/MM/YYYY');
  const newRow = [ now, concept, amount ];
  await appendRow(sheetName, newRow);
  return `✅ Gasto personal agregado: ${concept} $${amount}`;
}

// Egresos
async function handleEgresoCommand(tokens, tipo) {
  const sheetName = (await findSheetByPrefix('ING-EGR')) || (`ING-EGR ${monthSheetName().split(' ')[0].substr(0,3).toUpperCase()} ${String(new Date().getFullYear()).slice(2)}`);
  const startRow = (tipo === 'facturado') ? 37 : 16;
  const amount = parseFloat(tokens[1].replace(/[^0-9.-]/g,'')) || '';
  const concept = tokens.slice(2).join(' ') || '';
  const readRange = `${sheetName}!A${startRow}:B1000`;
  const grid = await readSheetValues(readRange);
  let emptyIndex = -1;
  for (let i = 0; i < grid.length; i++){
    const row = grid[i];
    const a = (row[0] || '').toString().trim();
    const b = (row[1] || '').toString().trim();
    if (a === '' && b === '') { emptyIndex = i; break; }
  }
  if (emptyIndex === -1) emptyIndex = grid.length;
  const sheetRow = startRow + emptyIndex;
  const rangeA1 = `A${sheetRow}:B${sheetRow}`;
  await updateRowRange(sheetName, rangeA1, [[concept, amount]]);
  return `✅ Egreso (${tipo}) agregado: ${concept} $${amount}`;
}

async function findSheetByPrefix(prefix) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const names = meta.data.sheets.map(s => s.properties.title);
  const found = names.find(n => n.toUpperCase().startsWith(prefix.toUpperCase()));
  return found || null;
}

// ----------------- WhatsApp client setup -----------------
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

client.on('qr', qr => {
  console.log('Escanea este QR con tu WhatsApp (ASCII en consola):');
  qrcodeTerminal.generate(qr, { small: true });

  // --- NUEVO: guardar QR como imagen ---
  qrcode.toFile('qr.png', qr, function (err) {
    if (err) throw err;
    console.log('✅ QR guardado como qr.png, listo para escanear.');
  });
});

client.on('authenticated', (sessionData) => {
  console.log('WhatsApp autenticado, guarda session.json localmente si necesitas.');
});

client.on('ready', () => {
  console.log('✅ Bot conectado a WhatsApp y listo.');
});

client.on('message', async msg => {
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

// small http server for Render healthcheck
const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type':'text/plain'});
  res.end('MoltoBello bot running\n');
}).listen(PORT, () => console.log(`Server on ${PORT}`));
