const axios = require('axios');
const https = require('https');
const { Pool } = require('pg');

async function scrapeBcvRates() {
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
    console.error('Error scraping BCV website:', error.message);
    throw error;
  }
}

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    // 1. Create the table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS exchange_rates (
        id SERIAL PRIMARY KEY,
        dolar NUMERIC NOT NULL,
        euro NUMERIC NOT NULL,
        fecha_bcv TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Scrape data
    const scrapedData = await scrapeBcvRates();
    let finalDolar = scrapedData.dolar;
    let finalEuro = scrapedData.euro;
    let finalFecha = scrapedData.bcvDate;

    // 3. Get the latest rate from DB
    const res = await pool.query('SELECT * FROM exchange_rates ORDER BY id DESC LIMIT 1;');
    const lastRate = res.rows[0];

    const currentDate = new Date();

    // If the date from BCV is greater than the current date (in the future)
    if (scrapedData.bcvDate > currentDate) {
      console.log('BCV date is in the future. Checking last recorded rate...');
      if (lastRate) {
        console.log('Using the previous rate from database.');
        finalDolar = parseFloat(lastRate.dolar);
        finalEuro = parseFloat(lastRate.euro);
        finalFecha = lastRate.fecha_bcv;
      } else {
        console.log('No previous rate found in database. Proceeding to save scraped rate anyway.');
      }
    } else {
      console.log('BCV date is valid (<= current date). Using scraped rates.');
    }

    // 4. Save the rate into the database
    await pool.query(
      `INSERT INTO exchange_rates (dolar, euro, fecha_bcv) VALUES ($1, $2, $3)`,
      [finalDolar, finalEuro, finalFecha]
    );

    console.log(`Successfully saved rates: Dolar ${finalDolar}, Euro ${finalEuro}, Date: ${finalFecha.toISOString()}`);
  } catch (err) {
    console.error('An error occurred during database operations:', err.message);
  } finally {
    await pool.end();
  }
}

main();