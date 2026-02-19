/**
 * Puppeteer test to verify Book of Work loads and displays data
 */

const puppeteer = require('puppeteer');

async function testBookOfWork() {
  console.log('Starting Book of Work UI test...\n');

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1920,1080'
    ]
  });

  const page = await browser.newPage();

  // Capture console logs
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error' || text.includes('[BookOfWork]')) {
      console.log(`[Browser ${type.toUpperCase()}]`, text);
    }
  });

  // Capture page errors
  page.on('pageerror', error => {
    console.error('[PAGE ERROR]', error.message);
  });

  try {
    console.log('Navigating to prix6.win...');
    await page.goto('https://prix6.win', { waitUntil: 'networkidle2', timeout: 30000 });

    console.log('Waiting for login form...');
    await page.waitForSelector('input[placeholder*="mercedes.com"]', { timeout: 10000 });

    console.log('\n⏳ MANUAL LOGIN REQUIRED');
    console.log('Please log in with admin credentials...');
    console.log('Waiting up to 60 seconds...\n');

    // Wait for admin panel to be accessible (login redirect)
    await page.waitForFunction(
      () => window.location.pathname !== '/login' && window.location.pathname !== '/',
      { timeout: 60000 }
    );

    console.log('✓ Login detected, navigating to admin panel...');

    await page.goto('https://prix6.win/admin', { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait for the page to be ready
    await page.waitForTimeout(3000);

    console.log('Waiting for Book of Work tab...');
    await page.waitForSelector('button[value="bookofwork"]', { timeout: 10000 });

    console.log('Clicking Book of Work tab...');
    await page.click('button[value="bookofwork"]');

    // Wait a moment for tab content to load
    await page.waitForTimeout(2000);

    console.log('\nChecking page state...');

    // Check if loading skeleton is visible
    const hasLoadingSkeleton = await page.evaluate(() => {
      const skeletons = document.querySelectorAll('[class*="skeleton"]');
      return skeletons.length > 0;
    });

    console.log('Loading skeleton visible:', hasLoadingSkeleton);

    // Check if "Loading record X of Y" text exists
    const loadingText = await page.evaluate(() => {
      const text = document.body.innerText;
      const match = text.match(/Loading record (\d+) of (\d+)/);
      return match ? { current: match[1], total: match[2] } : null;
    });

    console.log('Loading progress text:', loadingText);

    // Wait up to 30 seconds for data to load (or skeleton to disappear)
    console.log('\nWaiting for data to load (max 30s)...');

    const dataLoaded = await page.waitForFunction(
      () => {
        const skeletons = document.querySelectorAll('[class*="skeleton"]');
        const hasTable = document.querySelector('table');
        const hasRows = document.querySelectorAll('tbody tr').length > 0;
        return skeletons.length === 0 || hasRows;
      },
      { timeout: 30000 }
    ).catch(() => false);

    if (!dataLoaded) {
      console.error('\n❌ TIMEOUT: Data did not load after 30 seconds');
      console.log('Taking screenshot...');
      await page.screenshot({ path: 'book-of-work-timeout.png', fullPage: true });

      // Check for error messages
      const errorMessages = await page.evaluate(() => {
        const errors = [];
        document.querySelectorAll('[role="alert"], [class*="error"]').forEach(el => {
          errors.push(el.innerText);
        });
        return errors;
      });

      if (errorMessages.length > 0) {
        console.log('\nError messages found:');
        errorMessages.forEach(msg => console.log('  -', msg));
      }

      await browser.close();
      process.exit(1);
    }

    console.log('✓ Data loaded!');

    // Get actual data from the page
    const stats = await page.evaluate(() => {
      const totalText = document.querySelector('[class*="text-2xl"]')?.innerText;
      const tableRows = document.querySelectorAll('tbody tr');
      const filterText = document.body.innerText.match(/Showing (\d+) of (\d+) items/);

      return {
        displayedTotal: totalText,
        tableRows: tableRows.length,
        filterShowing: filterText ? filterText[1] : null,
        filterTotal: filterText ? filterText[2] : null
      };
    });

    console.log('\n📊 PAGE DATA:');
    console.log('  Total items (banner):', stats.displayedTotal);
    console.log('  Table rows visible:', stats.tableRows);
    console.log('  Filter showing:', stats.filterShowing, 'of', stats.filterTotal);

    // Check if filters work
    console.log('\nTesting package filter...');
    await page.click('[class*="SelectTrigger"]:has-text("Package")');
    await page.waitForTimeout(500);

    const packageOptions = await page.evaluate(() => {
      const options = [];
      document.querySelectorAll('[role="option"]').forEach(opt => {
        options.push(opt.innerText);
      });
      return options;
    });

    console.log('Package filter options:', packageOptions);

    // Take success screenshot
    console.log('\nTaking screenshot...');
    await page.screenshot({ path: 'book-of-work-success.png', fullPage: true });

    console.log('\n✅ TEST PASSED - Book of Work is loading correctly');
    console.log(`Found ${stats.filterTotal || stats.tableRows} items in Firestore`);

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    await page.screenshot({ path: 'book-of-work-error.png', fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
}

testBookOfWork()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
