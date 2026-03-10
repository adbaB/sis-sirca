const axios = require('axios');
const pg = require('pg');

const mockQuery = jest.fn();
const mockEnd = jest.fn();

jest.mock('pg', () => {
  return {
    Pool: jest.fn(() => ({
      query: mockQuery,
      end: mockEnd,
    }))
  };
});

const { scrapeBcvRates, main } = require('./bcv-scraper');

describe('BCV Scraper Cron Script', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReset();
    mockEnd.mockReset();

    if (axios.get && axios.get.mockReset) {
      axios.get.mockReset();
    }

    // Silence console logs during tests to keep output clean
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('scrapeBcvRates', () => {
    it('should extract dolar, euro and date from valid BCV HTML response', async () => {
      const mockHtml = `
        <div id="euro">
          <strong> 123,45 </strong>
        </div>
        <div id="dolar">
          <strong> 543,21 </strong>
        </div>
        Fecha Valor: <span content="2023-10-15T00:00:00-04:00"></span>
      `;

      jest.spyOn(axios, 'get').mockResolvedValueOnce({ data: mockHtml });

      const result = await scrapeBcvRates();

      expect(result).toEqual({
        dolar: 543.21,
        euro: 123.45,
        bcvDate: new Date('2023-10-15T00:00:00-04:00'),
      });
    });

    it('should throw an error if elements are missing from HTML', async () => {
      const mockHtml = `
        <div>Invalid HTML format</div>
      `;

      jest.spyOn(axios, 'get').mockResolvedValueOnce({ data: mockHtml });

      await expect(scrapeBcvRates(1)).rejects.toThrow('Could not extract rates or date from BCV website.');
    });

    it('should retry on failure and succeed if subsequent request is valid', async () => {
      const mockHtml = `
        <div id="euro"><strong> 123,45 </strong></div>
        <div id="dolar"><strong> 543,21 </strong></div>
        Fecha Valor: <span content="2023-10-15T00:00:00-04:00"></span>
      `;

      const getSpy = jest.spyOn(axios, 'get');
      getSpy.mockRejectedValueOnce(new Error('Network error 1'));
      getSpy.mockRejectedValueOnce(new Error('Network error 2'));
      getSpy.mockResolvedValueOnce({ data: mockHtml });

      const result = await scrapeBcvRates(3);

      expect(getSpy).toHaveBeenCalledTimes(3);
      expect(result).toEqual({
        dolar: 543.21,
        euro: 123.45,
        bcvDate: new Date('2023-10-15T00:00:00-04:00'),
      });
    });
  });

  describe('main', () => {
    const mockCurrentDate = new Date('2023-10-15T12:00:00Z');

    beforeEach(() => {
      // Mock system time
      jest.useFakeTimers().setSystemTime(mockCurrentDate);
      mockQuery.mockReset();
      mockEnd.mockReset();

      // Setup default mock implementation so we can track calls better
      mockQuery.mockResolvedValue({ rows: [] });
      mockEnd.mockResolvedValue();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should save newly scraped rates if BCV date is valid (<= current date)', async () => {
      // Simulate scraping returning a valid date in the past
      const scrapedDate = new Date('2023-10-14T00:00:00-04:00');
      const mockHtml = `
        <div id="euro"><strong> 10,00 </strong></div>
        <div id="dolar"><strong> 10,00 </strong></div>
        Fecha Valor: <span content="${scrapedDate.toISOString()}"></span>
      `;

      jest.spyOn(axios, 'get').mockResolvedValueOnce({ data: mockHtml });

      // Simulate no previous DB records for simplicity, though valid date means we just use new rate
      mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT query
      mockQuery.mockResolvedValueOnce({}); // INSERT query

      await main();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO exchange_rate ("rateUsd", "rateEur", "date")'),
        [10.0, 10.0, scrapedDate]
      );
    });

    it('should save previous DB rates if newly scraped BCV date is in the future', async () => {
      // Simulate scraping returning a date in the future
      const scrapedFutureDate = new Date('2023-10-16T00:00:00-04:00');
      const mockHtml = `
        <div id="euro"><strong> 20,00 </strong></div>
        <div id="dolar"><strong> 20,00 </strong></div>
        Fecha Valor: <span content="${scrapedFutureDate.toISOString()}"></span>
      `;
      jest.spyOn(axios, 'get').mockResolvedValueOnce({ data: mockHtml });

      // Mock DB: previous rate exists
      const lastRateDate = new Date('2023-10-14T00:00:00-04:00');
      const mockLastRate = {
        rateUsd: '15.00',
        rateEur: '15.00',
        date: lastRateDate
      };

      mockQuery.mockResolvedValueOnce({ rows: [mockLastRate] }); // SELECT query
      mockQuery.mockResolvedValueOnce({}); // INSERT query

      await main();

      // Ensure it inserts the OLD rate (from DB) not the newly scraped one (20.00)
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO exchange_rate ("rateUsd", "rateEur", "date")'),
        [15.0, 15.0, lastRateDate]
      );
    });

    it('should save newly scraped rates even if date is future but NO previous DB rate exists', async () => {
      // Simulate scraping returning a date in the future
      const scrapedFutureDate = new Date('2023-10-16T00:00:00-04:00');
      const mockHtml = `
        <div id="euro"><strong> 30,00 </strong></div>
        <div id="dolar"><strong> 30,00 </strong></div>
        Fecha Valor: <span content="${scrapedFutureDate.toISOString()}"></span>
      `;
      jest.spyOn(axios, 'get').mockResolvedValueOnce({ data: mockHtml });

      // Mock DB: no previous rates
      mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT query (empty)
      mockQuery.mockResolvedValueOnce({}); // INSERT query

      await main();

      // Ensure it falls back to inserting the new rate because there is no last rate
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO exchange_rate ("rateUsd", "rateEur", "date")'),
        [30.0, 30.0, scrapedFutureDate]
      );
    });

    it('should safely catch errors and close the connection', async () => {
      // Cause an error during scrape
      const getSpy = jest.spyOn(axios, 'get');
      getSpy.mockRejectedValue(new Error('Network error'));

      // We need to resolve the pending promises generated by setTimeout inside our scraper
      // Since it's inside an async loop we can step the timers and await process ticks
      const mainPromise = main();

      for(let i = 0; i < 5; i++){
        await Promise.resolve(); // flush pending promise callbacks
        jest.runOnlyPendingTimers();
      }

      await mainPromise;

      expect(console.error).toHaveBeenCalledWith(
        'An error occurred during database operations:',
        expect.any(String) // Just check it's called with some error string
      );
      // Ensure pool.end is still called
      expect(mockEnd).toHaveBeenCalled();
    });
  });
});