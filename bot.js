import 'dotenv/config';
import fs from 'fs';
import express from 'express';
import qrcode from 'qrcode';
import pkg from 'whatsapp-web.js';
import { google } from 'googleapis';
import dayjs from 'dayjs';

const { Client, LocalAuth } = pkg;

// Inicializar servidor Express (para ver el QR como imagen)
const app = express();
app.get('/', (req, res) => {
  res.send('MoltoBot corriendo. Visita /qr para ver el código QR.');
});
app.get('/qr', (req, res) => {
  if (fs.existsSync('qr.png')) {
    res.sendFile(process.cwd() + '/qr.png');
  } else {
    res.send('QR aún no generado. Espera unos segundos o reinicia el bot.');
  }
});
app.listen(process.env.PORT || 10000, () =>
  console.log(`🌐 Servidor escuchando en puerto ${process.env.PORT || 10000}`)
);

// === Google Sheets ===
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(Buffer.from(process.env.SERVICE_ACCOUNT_JSON, 'base64').toString('utf8')),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// === WhatsApp setup ===
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

// Cargar sesión desde variable (si existe)
let sessionData = null;
if (process.env.SESSION_BASE64 && process.env.SESSION_BASE64.trim() !== '') {
  try {
    sessionData = JSON.parse(
      Buffer.from(process.env.SESSION_BASE64, 'base64').toString('utf8')
    );
    console.log('✅ Sesión cargada desde SESSION_BASE64.');
  } catch (e) {
    console.log('⚠️ No se pudo cargar la sesión desde Base64:', e.message);
  }
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'molto-session' }),
  session: sessionData || undefined,
});


client.on('authenticated', (session) => {
  const base64Session = Buffer.from(JSON.stringify(session)).toString('base64');
  console.log('💾 Guarda este texto en SESSION_BASE64 para mantener la sesión:');
  console.log(base64Session);
});

client.on('message', async (message) => {
  // 👇 ESTA LÍNEA SE COMENTÓ PARA ACEPTAR TODOS LOS NÚMEROS 👇
  // if (!message.from.includes(process.env.WHATSAPP_NUMBER)) return;

  const msg = message.body.trim().toLowerCase();
  const fecha = dayjs().format('DD/MM/YYYY');

  try {
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
    } else if (msg.startsWith('gastos')) {
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
    } else if (msg.startsWith('facturado')) {
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
    } else if (msg.startsWith('sin facturar')) {
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
  } catch (error) {
    console.error('Error al procesar mensaje:', error);
    await message.reply('⚠️ Hubo un error al guardar la información.');
  }
});

client.initialize();
