import express from 'express';
import puppeteer from 'puppeteer';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

console.log('🚀 Servidor de scraping iniciado...');

app.post('/sync-apex', async (req, res) => {
  const { platform_url, username, password } = req.body;

  if (!platform_url || !username || !password) {
    return res.status(400).json({ error: 'Faltan credenciales' });
  }

  let browser = null;

  try {
    console.log(`[SCRAPE] Iniciando sesión en Apex...`);
    
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: true,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    console.log('[SCRAPE] Navegando a Apex...');
    await page.goto(platform_url, { waitUntil: 'networkidle2', timeout: 30000 });

    const hasLoginForm = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="password"]');
      return inputs.length >= 2;
    });

    if (!hasLoginForm) {
      console.log('[SCRAPE] Click en Login...');
      await page.click('a[href*="login"], a[href*="member"]').catch(() => {});
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log('[SCRAPE] Ingresando credenciales...');
    const usernameField = await page.$('input[type="text"], input[type="email"]');
    const passwordField = await page.$('input[type="password"]');

    if (!usernameField || !passwordField) {
      throw new Error('No se encontraron los campos de login');
    }

    await usernameField.type(username, { delay: 50 });
    await passwordField.type(password, { delay: 50 });

    await page.click('button[type="submit"], button:contains("Login")').catch(() => {});
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    console.log('[SCRAPE] Extrayendo datos...');
    
    const data = await page.evaluate(() => {
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : '';
      };

      const parseNumber = (text) => {
        const num = parseFloat(text.replace(/[^0-9.-]/g, ''));
        return isNaN(num) ? 0 : num;
      };

      let balance = 0;
      const balanceText = getText('[class*="balance"], [data-testid*="balance"]');
      if (balanceText) balance = parseNumber(balanceText);

      let profitTarget = 0;
      const ptText = getText('[class*="profit"], [data-testid*="profit"]');
      if (ptText) profitTarget = parseNumber(ptText);

      let maxDrawdown = 0;
      const ddText = getText('[class*="drawdown"], [data-testid*="drawdown"]');
      if (ddText) maxDrawdown = parseNumber(ddText);

      const trades = [];
      const tradeRows = document.querySelectorAll('table tbody tr, [class*="trade"]');
      tradeRows.forEach((row, i) => {
        if (i < 20) {
          const cells = row.querySelectorAll('td');
          if (cells.length > 0) {
            trades.push({
              date: cells[0]?.textContent || '',
              symbol: cells[1]?.textContent || '',
              type: cells[2]?.textContent || '',
              pnl: parseNumber(cells[3]?.textContent || '0')
            });
          }
        }
      });

      return { balance, profitTarget, maxDrawdown, trades };
    });

    console.log('[SCRAPE] Datos extraídos:', data);
    await browser.close();

    res.json({
      success: true,
      data: {
        balance: data.balance || 50000,
        profit_target: data.profitTarget || 3000,
        max_drawdown: data.maxDrawdown || 2500,
        daily_drawdown: Math.round((data.maxDrawdown || 2500) * 0.5),
        trades: data.trades || []
      }
    });

  } catch (error) {
    console.error('[SCRAPE] Error:', error.message);
    if (browser) await browser.close();
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en puerto ${PORT}`);
});