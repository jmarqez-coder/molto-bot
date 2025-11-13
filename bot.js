import 'dotenv/config';
import fs from 'fs';
import express from 'express';
import qrcode from 'qrcode';
import pkg from 'whatsapp-web.js';
import { google } from 'googleapis';
import dayjs from 'dayjs';

// 🔹 Ajuste para compatibilidad con CommonJS
const { Client, LocalAuth } = pkg;

// Inicializar Express para mostrar el QR
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

// === Google Sheets setup ===
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(Buffer.from(process.env.SERVICE_ACCOUNT_JSON, 'base64').toString('utf8')),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// === WhatsApp setup ===
const client = new Client({ authStrategy: new LocalAuth() });

client.on('qr', async (qr) => {
  console.log('Generando QR en imagen PNG...');
  await qrcode.toFile('qr.png', qr);
  console.log(`✅ QR generado: abre tu enlace Render en /qr para escanearlo`);
});

client.on('ready', () => {
  console.log('✅ WhatsApp conectado y listo para registrar tus ventas y gastos.');
});

client.on('message', async (message) => {
  if (message.from !== `${process.env.WHATSAPP_NUMBER}@c.us`) return;
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
    console.error('Error al procesar mensaje:', er
