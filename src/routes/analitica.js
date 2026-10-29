const router = require('express').Router();
const db = require('../config/db');
const { ah, autenticar, requierePermiso } = require('../middleware/auth');
const { calcular, aTabla } = require('../services/analitica');
const { bad } = require('../services/validar');

router.use(autenticar);
const ver = requierePermiso('analitica', 'consulta');

// HU-6.1 y 6.2: indicadores del periodo
router.get('/', ver, ah(async (req, res) => res.json(await calcular(req.query.desde, req.query.hasta))));

// Meta de respuesta (minutos) con la que se compara el promedio
router.put('/meta', requierePermiso('analitica', 'total'), ah(async (req, res) => {
  const min = Number(req.body?.minutos);
  if (!Number.isInteger(min) || min < 1 || min > 120) throw bad('Escribe una meta entre 1 y 120 minutos.');
  await db.query("INSERT INTO ajustes (clave, valor) VALUES ('meta_respuesta_min', ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)", [String(min)]);
  res.json({ minutos: min });
}));

// HU-6.3: exportar a Excel
router.get('/excel', ver, ah(async (req, res) => {
  const ExcelJS = require('exceljs');
  const tabla = aTabla(await calcular(req.query.desde, req.query.hasta));
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Analítica');
  hoja.columns = [{ width: 42 }, { width: 24 }, { width: 24 }];

  hoja.addRow([tabla.titulo]).font = { bold: true, size: 14 };
  hoja.addRow([tabla.subtitulo]);
  for (const seccion of tabla.secciones) {
    hoja.addRow([]);
    hoja.addRow([seccion.titulo]).font = { bold: true, size: 12 };
    if (seccion.encabezado) hoja.addRow(seccion.encabezado).font = { bold: true };
    for (const fila of seccion.filas) hoja.addRow(fila);
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="analitica.xlsx"');
  await libro.xlsx.write(res);
  res.end();
}));

// HU-6.3: exportar a PDF
router.get('/pdf', ver, ah(async (req, res) => {
  const PDFDocument = require('pdfkit');
  const tabla = aTabla(await calcular(req.query.desde, req.query.hasta));
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="analitica.pdf"');
  doc.pipe(res);

  doc.font('Helvetica-Bold').fontSize(16).text(tabla.titulo);
  doc.font('Helvetica').fontSize(10).fillColor('#555').text(tabla.subtitulo).fillColor('#000');

  const ancho = [260, 110, 110];
  const fila = (celdas, negrita) => {
    if (doc.y > 760) doc.addPage();
    const y = doc.y;
    doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
    let x = doc.page.margins.left;
    celdas.forEach((c, i) => { doc.text(String(c), x, y, { width: ancho[i] - 8, lineBreak: false }); x += ancho[i]; });
    doc.y = y + 16;
    doc.x = doc.page.margins.left;
  };
  for (const seccion of tabla.secciones) {
    doc.moveDown(0.8);
    if (doc.y > 720) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(12).text(seccion.titulo);
    doc.moveDown(0.3);
    if (seccion.encabezado) fila(seccion.encabezado, true);
    for (const f of seccion.filas) fila(f, false);
  }
  doc.end();
}));

module.exports = router;
