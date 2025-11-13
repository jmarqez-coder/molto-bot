import 'dotenv/config';
import qrcode from 'qrcode-terminal';
import { Client, LocalAuth } from 'whatsapp-web.js';
import { google } from 'googleapis';
import dayjs from 'dayjs';

// Configuración de Google Sheets
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(Buffer.from(process.env.SERVICE_ACCOUNT_JSON, 'base64').toString('utf8')),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// Inicializar WhatsApp
const client = new Client({
  authStrategy: new LocalAuth(),
});

client.on('qr', (qr) => {
  console.log('Escanea este código QR para vincular WhatsApp:\n');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp conectado y listo para trabajar.');
});

client.on('message', async (message) => {
  if (message.from !== `${process.env.WHATSAPP_NUMBER}@c.us`) return;

  const msg = message.body.trim().toLowerCase();
  const fecha = dayjs().format('DD/MM/YYYY');

  // === VENTA ===
  if (msg.startsWith('venta')) {
    const datos = message.body.substring(6).split(',');
    const [cliente, descripcion, fechaEstimada, pago, venta, anticipo] = datos.map((d) => d?.trim() || '');
    const row = [fecha, cliente, descripcion, fechaEstimada, pago, venta, anticipo];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'NOVIEMBRE 2025!B2',
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] },
    });
    await message.reply('✅ Venta registrada en *NOVIEMBRE 2025*');
  }

  // === GASTOS PERSONALES ===
  else if (msg.startsWith('gastos')) {
    const datos = message.body.substring(7).split(',');
    const [concepto, cantidad] = datos.map((d) => d?.trim() || '');
    const row = [fecha, concepto, cantidad];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'GASTOS NOV 25!A2',
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] },
    });
    await message.reply('💸 Gasto personal agregado a *GASTOS NOV 25*');
  }

  // === EGRESOS FACTURADOS ===
  else if (msg.startsWith('facturado')) {
    const datos = message.body.substring(10).split(',');
    const [concepto, cantidad] = datos.map((d) => d?.trim() || '');
    const row = [concepto, cantidad];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'ING-EGR NOV 25!B37',
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] },
    });
    await message.reply('📄 Egreso *facturado* registrado en *ING-EGR NOV 25*');
  }

  // === EGRESOS SIN FACTURAR ===
  else if (msg.startsWith('sin facturar')) {
    const datos = message.body.substring(13).split(',');
    const [concepto, cantidad] = datos.map((d) => d?.trim() || '');
    const row = [concepto, cantidad];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'ING-EGR NOV 25!B16',
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] },
    });
    await message.reply('🧾 Egreso *sin factura* agregado en *ING-EGR NOV 25*');
  }
});

client.initialize();
