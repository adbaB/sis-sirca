const axios = require('axios');
const https = require('https');
const { Pool } = require('pg');
const path = require('path');
// Configura dotenv para buscar el archivo .env en la raíz del proyecto (dos niveles arriba).
// Si no existe (ej. en producción donde se usan variables de sistema), las variables ya 
// deberían estar inyectadas por el sistema.
try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
} catch (e) {
  // dotenv no está instalado. Se asumirá que las variables de entorno están inyectadas por el sistema.
}

async function scrapeBcvRates(retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`[BCV] Fetching https://www.bcv.org.ve/ ...`);
      const agent = new https.Agent({ rejectUnauthorized: false });
      const { data, status } = await axios.get('https://www.bcv.org.ve/', {
        httpsAgent: agent,
        timeout: 15000,
      });
      console.log(`[BCV] HTTP ${status} — HTML length: ${data.length} chars`);

      // Sanity check: make sure the page returned real content
      if (!data || data.length < 1000) {
        throw new Error(`Unexpected HTML response (length=${data ? data.length : 0}). Possible block or redirect.`);
      }

      // Extract dollar
      const dolarMatch = data.match(/<div id="dolar"[\s\S]*?<strong[^>]*>\s*(.*?)\s*<\/strong>/);
      const dolarRaw = dolarMatch ? dolarMatch[1] : null;
      const dolarStr = dolarRaw ? dolarRaw.replace(',', '.') : null;
      const dolar = dolarStr ? parseFloat(dolarStr) : null;
      console.log(`[BCV] Dolar — raw: "${dolarRaw}" → parsed: ${dolar}`);

      // Extract euro
      const euroMatch = data.match(/<div id="euro"[\s\S]*?<strong[^>]*>\s*(.*?)\s*<\/strong>/);
      const euroRaw = euroMatch ? euroMatch[1] : null;
      const euroStr = euroRaw ? euroRaw.replace(',', '.') : null;
      const euro = euroStr ? parseFloat(euroStr) : null;
      console.log(`[BCV] Euro  — raw: "${euroRaw}" → parsed: ${euro}`);

      // Extract date
      const dateMatch = data.match(/Fecha Valor:[\s\S]*?content="(.*?)"/);
      const dateStr = dateMatch ? dateMatch[1] : null;
      const bcvDate = dateStr ? new Date(dateStr) : null;
      console.log(`[BCV] Fecha — raw: "${dateStr}" → parsed: ${bcvDate ? bcvDate.toISOString() : null}`);

      // Diagnose which field(s) failed before throwing a generic error
      if (!dolar || !euro || !bcvDate) {
        const missing = [
          !dolar && `dolar (regex matched: ${!!dolarMatch}, raw: "${dolarRaw}")`,
          !euro && `euro (regex matched: ${!!euroMatch}, raw: "${euroRaw}")`,
          !bcvDate && `date (regex matched: ${!!dateMatch}, raw: "${dateStr}")`,
        ].filter(Boolean);
        // Dump a small HTML fragment around id="dolar" to spot structural changes
        const dolarIdx = data.indexOf('id="dolar"');
        if (dolarIdx >= 0) {
          console.error(`[BCV] HTML fragment around id="dolar":\n${data.substring(dolarIdx, dolarIdx + 400)}`);
        } else {
          console.error('[BCV] id="dolar" NOT FOUND in HTML — the page structure may have changed.');
          // Show first 500 chars to detect blocks / error pages
          console.error(`[BCV] HTML head (first 500 chars):\n${data.substring(0, 500)}`);
        }
        throw new Error(`Could not extract: ${missing.join(' | ')}`);
      }

      console.log(`[BCV] Successfully scraped — Dolar: ${dolar}, Euro: ${euro}, Date: ${bcvDate.toISOString()}`);
      return { dolar, euro, bcvDate };
    } catch (error) {
      console.error(`[BCV] Error on attempt ${i + 1} of ${retries}: ${error.message}`);
      if (i === retries - 1) {
        throw error;
      }
      console.log(`[BCV] Retrying in 1 s...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

async function main() {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT ? parseInt(process.env.POSTGRES_PORT) : 5432,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });

  try {
    // 1. Scrape data
    const scrapedData = await scrapeBcvRates();
    let finalDolar = scrapedData.dolar;
    let finalEuro = scrapedData.euro;

    // Use Venezuela time (UTC-4) to determine "today" for the DB record.
    const nowVe = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Caracas' }));
    // Build a plain date string YYYY-MM-DD in Venezuela local time so Postgres stores
    // it as the correct calendar day regardless of the server's system timezone.
    const todayVe = new Date(
      nowVe.getFullYear(),
      nowVe.getMonth(),
      nowVe.getDate(),
    );
    console.log(`[DB] Venezuela now: ${nowVe.toISOString()} — storing as date: ${todayVe.toISOString()}`);

    // 2. Get the latest rate from DB
    console.log('[DB] Querying last exchange rate...');
    const res = await pool.query('SELECT * FROM exchange_rate ORDER BY "date" DESC LIMIT 1;');
    const lastRate = res.rows[0];
    console.log(`[DB] Last DB record: ${lastRate ? `Dolar ${lastRate.rateUsd}, Euro ${lastRate.rateEur}, Date ${lastRate.date}` : 'none'}`);

    // If the date published by BCV is in the future (e.g. Friday publishes Monday's value),
    // reuse the previous rates but record them under TODAY's date so that Saturday and Sunday
    // each get their own row in the DB with the correct (previous) rate.
    if (scrapedData.bcvDate > nowVe) {
      console.log('[DB] BCV date is in the future (weekend case). Using previous rates with today\'s date...');
      if (lastRate) {
        console.log(`[DB] Reusing last DB rates: Dolar ${lastRate.rateUsd}, Euro ${lastRate.rateEur}`);
        finalDolar = parseFloat(lastRate.rateUsd);
        finalEuro = parseFloat(lastRate.rateEur);
      } else {
        console.log('[DB] No previous rate found. Saving scraped rate as-is.');
      }
    } else {
      console.log('[DB] BCV date is current (<= now). Using scraped rates.');
    }

    // 3. Save the rate into the database using TODAY as the date key.
    // ON CONFLICT ensures idempotency if the cron runs more than once in the same day.
    console.log(`[DB] Upserting — Dolar: ${finalDolar}, Euro: ${finalEuro}, Date: ${todayVe.toISOString()}`);
    await pool.query(
      `INSERT INTO exchange_rate ("rateUsd", "rateEur", "date")
       VALUES ($1, $2, $3)
       ON CONFLICT ("date")
       DO UPDATE SET "rateUsd" = EXCLUDED."rateUsd", "rateEur" = EXCLUDED."rateEur", "updated_at" = now()`,
      [finalDolar, finalEuro, todayVe]
    );

    console.log(`[DB] ✓ Saved — Dolar: ${finalDolar}, Euro: ${finalEuro}, Date: ${todayVe.toISOString()}`);
  } catch (err) {
    console.error('[FATAL]', err);
  } finally {
    await pool.end();
  }
}


if (require.main === module) {
  main();
}

module.exports = {
  scrapeBcvRates,
  main
};