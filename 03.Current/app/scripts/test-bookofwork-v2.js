/**
 * Automated test for Book of Work panel using Puppeteer (Windows-optimized)
 * Tests the diagnostic logging and loading behavior
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

async function testBookOfWork() {
  console.log('Starting Book of Work panel test (Windows-optimized)...\n');

  // Create a clean user data directory
  const userDataDir = path.join(__dirname, '.puppeteer-test-profile');

  // Clean up old profile if it exists
  if (fs.existsSync(userDataDir)) {
    console.log('Cleaning up old test profile...');
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  let browser;
  try {
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: { width: 1280, height: 800 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        `--user-data-dir=${userDataDir}`,
      ],
      timeout: 60000,
    });

    const page = await browser.newPage();
    const consoleLogs = [];
    const errors = [];
    let documentCount = null;

    // Capture console logs
    page.on('console', (msg) => {
      const text = msg.text();
      consoleLogs.push(text);

      // Filter for Book of Work specific logs
      if (text.includes('[BookOfWork]')) {
        console.log(`📋 ${text}`);

        // Extract document count if present
        const match = text.match(/Received (\d+) documents/);
        if (match) {
          documentCount = parseInt(match[1]);
        }
      }
    });

    // Capture errors
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.error(`❌ Page Error: ${error.message}`);
    });

    // Capture failed network requests
    page.on('requestfailed', (request) => {
      console.warn(`⚠️  Failed request: ${request.url()}`);
    });

    console.log('\n1. Navigating to login page...');
    await page.goto('http://localhost:9002/login', {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    console.log('✓ Login page loaded\n');

    console.log('2. Waiting for login form...');
    await page.waitForSelector('input[placeholder*="mercedes.com"]', { timeout: 10000 });
    console.log('✓ Login form detected\n');

    console.log('⚠️  MANUAL STEP REQUIRED:');
    console.log('   Please log in as an admin user in the browser window.');
    console.log('   The test will continue after you reach the admin panel.');
    console.log('   (You have 3 minutes to log in)\n');

    // Wait for navigation to admin panel
    console.log('3. Waiting for admin panel navigation...');
    try {
      await page.waitForFunction(
        () => window.location.pathname.includes('/admin'),
        { timeout: 180000 } // 3 minutes
      );
      console.log('✓ Admin panel detected\n');
    } catch (e) {
      console.error('❌ Timeout waiting for admin panel. Did you log in?');
      throw new Error('User did not log in within 3 minutes');
    }

    // Wait for page to stabilize
    console.log('4. Waiting for page to load...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('5. Looking for Book of Work panel...');

    const hasBookOfWork = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Book of Work');
    });

    if (hasBookOfWork) {
      console.log('✓ "Book of Work" text found on page\n');
    } else {
      console.log('⚠️  "Book of Work" text not found - may need to scroll or expand section\n');
    }

    console.log('6. Monitoring console logs for 20 seconds...');
    console.log('   Watching for diagnostic messages:\n');

    // Monitor for 20 seconds (10s for potential timeout + 10s buffer)
    await new Promise(resolve => setTimeout(resolve, 20000));

    // Analyze results
    console.log('\n=== DIAGNOSTIC RESULTS ===\n');

    const bookOfWorkLogs = consoleLogs.filter(log => log.includes('[BookOfWork]'));

    if (bookOfWorkLogs.length === 0) {
      console.log('❌ NO DIAGNOSTIC LOGS CAPTURED');
      console.log('\nPossible causes:');
      console.log('  • BookOfWorkManager component not rendering');
      console.log('  • Not on the correct admin page');
      console.log('  • Component is conditional and not showing');
      console.log('\nDEBUG INFO:');
      console.log(`  Current URL: ${page.url()}`);
      console.log(`  "Book of Work" text found: ${hasBookOfWork}`);
    } else {
      console.log(`✓ Captured ${bookOfWorkLogs.length} diagnostic message(s)\n`);

      // Check for successful load
      const hasListenerStart = bookOfWorkLogs.some(log =>
        log.includes('Starting Firestore listener')
      );
      const hasDocuments = bookOfWorkLogs.some(log =>
        log.includes('Received') && log.includes('documents')
      );
      const hasTimeout = bookOfWorkLogs.some(log =>
        log.toLowerCase().includes('timeout')
      );
      const hasError = bookOfWorkLogs.some(log =>
        log.toLowerCase().includes('error') && !log.includes('error_logs')
      );
      const notAvailable = bookOfWorkLogs.some(log =>
        log.includes('not available')
      );

      console.log('STATUS CHECKS:');
      console.log(`  Listener started: ${hasListenerStart ? '✓' : '❌'}`);
      console.log(`  Documents loaded: ${hasDocuments ? '✓' : '❌'}`);
      if (documentCount !== null) {
        console.log(`  Document count: ${documentCount}`);
        if (documentCount === 31) {
          console.log('  ✓ Expected count (31) received!');
        } else {
          console.log(`  ⚠️  Unexpected count (expected 31, got ${documentCount})`);
        }
      }
      console.log(`  Timeout occurred: ${hasTimeout ? '❌ YES' : '✓ NO'}`);
      console.log(`  Errors detected: ${hasError ? '❌ YES' : '✓ NO'}`);
      console.log(`  Firestore unavailable: ${notAvailable ? '❌ YES' : '✓ NO'}`);

      // Overall assessment
      console.log('\nOVERALL ASSESSMENT:');
      if (hasDocuments && !hasTimeout && !hasError && !notAvailable) {
        console.log('✅ BOOK OF WORK IS LOADING CORRECTLY!');
        console.log('   The panel should be showing all work items with the progress indicator.');
      } else if (hasTimeout) {
        console.log('❌ ISSUE DETECTED: Firestore connection timeout');
        console.log('   Possible causes:');
        console.log('   • User not authenticated as admin');
        console.log('   • Firestore rules blocking access');
        console.log('   • Network connectivity issue');
      } else if (notAvailable) {
        console.log('❌ ISSUE DETECTED: Firestore instance not available');
        console.log('   Possible causes:');
        console.log('   • Firebase not initialized on this page');
        console.log('   • Environment variables missing');
        console.log('   • Import/initialization error');
      } else if (hasError) {
        console.log('❌ ISSUE DETECTED: Error in Firestore listener');
        console.log('   Check the error logs above for details');
      } else {
        console.log('⚠️  PARTIAL SUCCESS: Listener started but no documents loaded yet');
        console.log('   This might be normal if loading is slow. Check browser UI.');
      }
    }

    if (errors.length > 0) {
      console.log('\n=== PAGE ERRORS ===');
      errors.forEach(err => console.log(`  ❌ ${err}`));
    }

    console.log('\n=== TEST COMPLETE ===');
    console.log('Browser will close in 10 seconds...\n');
    console.log('(Press Ctrl+C to close immediately)\n');

    await new Promise(resolve => setTimeout(resolve, 10000));
    await browser.close();

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    if (browser) {
      await browser.close();
    }
    process.exit(1);
  } finally {
    // Clean up test profile
    if (fs.existsSync(userDataDir)) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch (e) {
        console.log(`\nNote: Could not delete test profile at ${userDataDir}`);
        console.log('You can manually delete it later if needed.');
      }
    }
  }
}

testBookOfWork().catch(console.error);
