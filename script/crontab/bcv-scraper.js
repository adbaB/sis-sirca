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
      const agent = new https.Agent({ rejectUnauthorized: false });
      const { data } = await axios.get('https://www.bcv.org.ve/', { httpsAgent: agent });

      // Extract dollar
      const dolarMatch = data.match(/<div id="dolar"[\s\S]*?<strong>\s*(.*?)\s*<\/strong>/);
      const dolarStr = dolarMatch ? dolarMatch[1].replace(',', '.') : null;
      const dolar = dolarStr ? parseFloat(dolarStr) : null;

      // Extract euro
      const euroMatch = data.match(/<div id="euro"[\s\S]*?<strong>\s*(.*?)\s*<\/strong>/);
      const euroStr = euroMatch ? euroMatch[1].replace(',', '.') : null;
      const euro = euroStr ? parseFloat(euroStr) : null;

      // Extract date
      const dateMatch = data.match(/Fecha Valor:[\s\S]*?content="(.*?)"/);
      const dateStr = dateMatch ? dateMatch[1] : null;
      const bcvDate = dateStr ? new Date(dateStr) : null;

      if (!dolar || !euro || !bcvDate) {
        throw new Error('Could not extract rates or date from BCV website.');
      }

      console.log(`Scraped from BCV - Dolar: ${dolar}, Euro: ${euro}, Date: ${bcvDate.toISOString()}`);
      return { dolar, euro, bcvDate };
    } catch (error) {
      console.error(`Error scraping BCV website (Attempt ${i + 1} of ${retries}):`, error.message);
      if (i === retries - 1) {
        throw error;
      }
      // Wait for a second before retrying
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

    // 2. Get the latest rate from DB
    const res = await pool.query('SELECT * FROM exchange_rate ORDER BY "date" DESC LIMIT 1;');
    const lastRate = res.rows[0];

    // If the date published by BCV is in the future (e.g. Friday publishes Monday's value),
    // reuse the previous rates but record them under TODAY's date so that Saturday and Sunday
    // each get their own row in the DB with the correct (previous) rate.
    if (scrapedData.bcvDate > nowVe) {
      console.log('BCV date is in the future (weekend case). Using previous rates with today\'s date...');
      if (lastRate) {
        console.log(`Reusing rates from last DB record: Dolar ${lastRate.rateUsd}, Euro ${lastRate.rateEur}`);
        finalDolar = parseFloat(lastRate.rateUsd);
        finalEuro = parseFloat(lastRate.rateEur);
      } else {
        console.log('No previous rate found in database. Saving scraped rate as-is.');
      }
    } else {
      console.log('BCV date is valid (<= current date). Using scraped rates.');
    }

    // 3. Save the rate into the database using TODAY as the date key.
    // ON CONFLICT ensures idempotency if the cron runs more than once in the same day.
    await pool.query(
      `INSERT INTO exchange_rate ("rateUsd", "rateEur", "date")
       VALUES ($1, $2, $3)
       ON CONFLICT ("date")
       DO UPDATE SET "rateUsd" = EXCLUDED."rateUsd", "rateEur" = EXCLUDED."rateEur", "updated_at" = now()`,
      [finalDolar, finalEuro, todayVe]
    );

    console.log(`Successfully saved rates: Dolar ${finalDolar}, Euro ${finalEuro}, Date: ${todayVe.toISOString()}`);
  } catch (err) {
    console.log(err);
    console.error('An error occurred during database operations:', err.message);
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