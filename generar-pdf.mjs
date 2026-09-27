/**
 * generar-pdf.mjs
 * -----------------------------------------------------------
 * Genera un PDF de UNA SOLA PÁGINA LARGA (tipo tira continua)
 * con la invitación tal como se ve en el celular.
 *
 * Uso:  npm run build   &&   node generar-pdf.mjs
 * Salida: Invitacion-Rene-y-Lourdes.pdf
 * -----------------------------------------------------------
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "dist");

// ── Ajustes ────────────────────────────────────────────────
const RUTA = process.env.RUTA || "/";            // página a capturar
const ANCHO = 430;        // ancho del "celular" en px CSS
const ESCALA = Number(process.env.ESCALA || 3); // 3 = alta resolución (retina)
const FORMATO = (process.env.FORMATO || "png").toLowerCase(); // png = máxima calidad · jpg = archivo liviano
const PASO = 900;         // alto de cada tajada capturada
const COLCHON = 900;      // px extra de viewport para pre-cargar animaciones
const SALIDA = process.env.SALIDA || "Invitacion-Rene-y-Lourdes.pdf";
const MAX_PDF_PT = 14400; // límite de tamaño de página del formato PDF
// ───────────────────────────────────────────────────────────

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".ttf": "font/ttf",
  ".woff": "font/woff", ".woff2": "font/woff2", ".mp3": "audio/mpeg",
  ".json": "application/json", ".ico": "image/x-icon",
};

function servir() {
  const server = http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split("?")[0]);
    let file = path.join(DIST, url);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!fs.existsSync(DIST)) {
    console.error('✗ No existe la carpeta dist/. Ejecuta primero:  npm run build');
    process.exit(1);
  }

  const server = await servir();
  const puerto = server.address().port;
  const base = `http://127.0.0.1:${puerto}`;
  console.log(`▸ Servidor local en ${base}`);

  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({
    viewport: { width: ANCHO, height: PASO + COLCHON },
    deviceScaleFactor: ESCALA,
    isMobile: true,
    hasTouch: true,
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
  const page = await contexto.newPage();

  console.log("▸ Cargando la invitación…");
  await page.goto(base + RUTA, { waitUntil: "networkidle" });

  // Quitar el sobre de portada (el "DALE CLICK") y el botón flotante de música
  await page.evaluate(() => {
    document.getElementById("portada-sobre")?.remove();
    document.getElementById("btn-audio-control")?.remove();
    document.body.style.overflow = "auto";
    document.documentElement.style.overflow = "auto";
    document.documentElement.style.scrollBehavior = "auto";
  });

  // Esperar fuentes e imágenes
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images).map((img) =>
        img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; })
      )
    );
  });
  await espera(1500);

  const alto = await page.evaluate(() =>
    Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
  );
  console.log(`▸ Alto total: ${alto} px CSS  (${Math.ceil(alto / PASO)} tajadas)`);

  // ── Captura progresiva hacia abajo ──
  // Se baja siempre hacia abajo para que las animaciones GSAP queden
  // en su estado final (nunca se sube, porque se reiniciarían).
  const tajadas = [];
  let y = 0;
  while (y < alto) {
    await page.evaluate((py) => window.scrollTo(0, py), y);
    const real = await page.evaluate(() => window.scrollY);
    await espera(y === 0 ? 900 : 700);

    const altoViewport = PASO + COLCHON;
    const desfase = Math.max(0, Math.round((y - real) * ESCALA));
    const altoTajada = Math.min(PASO, alto - y);
    const altoPx = Math.min(
      Math.round(altoTajada * ESCALA),
      Math.round(altoViewport * ESCALA) - desfase
    );
    const shot = await page.screenshot({ type: "png" });
    const recorte = await sharp(shot)
      .extract({
        left: 0,
        top: desfase,
        width: Math.round(ANCHO * ESCALA),
        height: altoPx,
      })
      [FORMATO === "jpg" ? "jpeg" : "png"](FORMATO === "jpg" ? { quality: 92, chromaSubsampling: "4:4:4" } : {})
      .toBuffer();

    tajadas.push({ buffer: recorte, y, alto: altoPx / ESCALA });
    process.stdout.write(`\r  capturando… ${Math.min(100, Math.round(((y + altoTajada) / alto) * 100))}%   `);
    y += PASO;
  }
  console.log("\n▸ Captura completa.");

  await navegador.close();
  server.close();

  // ── Armar el PDF de una sola página larga ──
  const escalaPdf = alto > MAX_PDF_PT ? MAX_PDF_PT / alto : 1;
  const anchoPdf = ANCHO * escalaPdf;
  const altoPdf = alto * escalaPdf;

  const pdf = await PDFDocument.create();
  pdf.setTitle("Invitación de Boda — Rene y Lourdes");
  pdf.setAuthor("Rene y Lourdes");
  pdf.setSubject("Invitación de boda");

  const pagina = pdf.addPage([anchoPdf, altoPdf]);
  for (const t of tajadas) {
    const img = FORMATO === "jpg" ? await pdf.embedJpg(t.buffer) : await pdf.embedPng(t.buffer);
    pagina.drawImage(img, {
      x: 0,
      y: altoPdf - (t.y + t.alto) * escalaPdf,
      width: anchoPdf,
      height: t.alto * escalaPdf,
    });
  }

  const bytes = await pdf.save();
  fs.writeFileSync(path.join(__dirname, SALIDA), bytes);
  console.log(`✓ PDF generado: ${SALIDA}  (${(bytes.length / 1024 / 1024).toFixed(1)} MB, ${Math.round(anchoPdf)}×${Math.round(altoPdf)} pt)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
