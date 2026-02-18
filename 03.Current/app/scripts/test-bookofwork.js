/**
 * Automated test for Book of Work panel using Puppeteer
 * Tests the diagnostic logging and loading behavior
 */

const puppeteer = require('puppeteer');

async function testBookOfWork() {
  console.log('Starting Book of Work panel test...\n');

  const browser = await puppeteer.launch({
    headless: false, // Run in visible mode to see what's happening
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();
  const consoleLogs = [];
  const errors = [];

  // Capture console logs
  page.on('console', (msg) => {
    const text = msg.text();
    consoleLogs.push(text);

    // Filter for Book of Work specific logs
    if (text.includes('[BookOfWork]')) {
      console.log(`📋 ${text}`);
    }
  });

  // Capture errors
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(`❌ Page Error: ${error.message}`);
  });

  try {
    console.log('1. Navigating to login page...');
    await page.goto('http://localhost:9002/login', { waitUntil: 'networkidle0' });

    console.log('\n2. Waiting for login form...');
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });

    console.log('\n⚠️  MANUAL STEP REQUIRED:');
    console.log('   Please log in as an admin user in the browser window.');
    console.log('   The test will continue after you reach the admin panel.\n');

    // Wait for navigation to admin panel (wait up to 2 minutes for user to log in)
    console.log('3. Waiting for admin panel navigation...');
    await page.waitForFunction(
      () => window.location.pathname.includes('/admin'),
      { timeout: 120000 }
    );

    console.log('✓ Admin panel detected\n');

    // Wait a moment for the page to fully load
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('4. Checking for Book of Work panel...');

    // Look for the Book of Work section by its heading
    const bookOfWorkSection = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h3, h2'));
      const bookOfWorkHeading = headings.find(h =>
        h.textContent.includes('Book of Work')
      );
      return bookOfWorkHeading ? true : false;
    });

    if (bookOfWorkSection) {
      console.log('✓ Book of Work section found\n');
    } else {
      console.log('⚠️  Book of Work section not visible (may need to scroll or expand)\n');
    }

    console.log('5. Monitoring for 15 seconds to capture diagnostic logs...');
    console.log('   Looking for:');
    console.log('   - [BookOfWork] Starting Firestore listener...');
    console.log('   - [BookOfWork] Received X documents');
    console.log('   - Or timeout error after 10 seconds\n');

    // Wait 15 seconds to capture all diagnostic logs
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Check what we captured
    const bookOfWorkLogs = consoleLogs.filter(log => log.includes('[BookOfWork]'));

    console.log('\n=== DIAGNOSTIC RESULTS ===\n');

    if (bookOfWorkLogs.length === 0) {
      console.log('❌ NO DIAGNOSTIC LOGS CAPTURED');
      console.log('   This means the BookOfWorkManager component may not be rendering.');
      console.log('   Possible causes:');
      console.log('   - Not on the admin panel page');
      console.log('   - Component not mounted');
      console.log('   - Firestore instance not initialized\n');
    } else {
      console.log(`✓ Captured ${bookOfWorkLogs.length} diagnostic log(s):\n`);
      bookOfWorkLogs.forEach(log => console.log(`  ${log}`));

      // Check for specific conditions
      if (bookOfWorkLogs.some(log => log.includes('Starting Firestore listener'))) {
        console.log('\n✓ Listener initialization detected');
      }

      if (bookOfWorkLogs.some(log => log.includes('Received') && log.includes('documents'))) {
        console.log('✓ Documents successfully loaded');
      }

      if (bookOfWorkLogs.some(log => log.includes('timeout'))) {
        console.log('❌ TIMEOUT DETECTED - Firestore connection hanging');
      }

      if (bookOfWorkLogs.some(log => log.includes('error'))) {
        console.log('❌ ERROR DETECTED in diagnostic logs');
      }
    }

    if (errors.length > 0) {
      console.log('\n=== PAGE ERRORS ===\n');
      errors.forEach(err => console.log(`  ${err}`));
    }

    console.log('\n=== TEST COMPLETE ===');
    console.log('Browser will remain open for manual inspection.');
    console.log('Press Ctrl+C in terminal to close.\n');

    // Keep browser open for manual inspection
    await new Promise(() => {});

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await browser.close();
    process.exit(1);
  }
}

testBookOfWork().catch(console.error);
