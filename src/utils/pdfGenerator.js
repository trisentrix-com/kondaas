import puppeteer from 'puppeteer';

/**
 * PDF Generator Tool
 * This function takes HTML and turns it into a PDF file.
 */
export const generatePDF = async (htmlContent, outputPath) => {
  // 1. Launch the hidden browser
  const browser = await puppeteer.launch({
    headless: true, // Run in the background
    executablePath: '/usr/bin/chromium', // Path to Chromium in AWS/Linux environments
    args: ['--no-sandbox', '--disable-setuid-sandbox'] // Required for AWS/Linux environments
  });

  try {
    // 2. Open a new blank page
    const page = await browser.newPage();

    // 3. Set the content to our HTML
    await page.setContent(htmlContent);

    // 4. "Print" the page as a PDF
    await page.pdf({
      path: outputPath, // Where to save it temporarily
      format: 'A4',
      printBackground: true // Ensures colors/images show up
    });

    return outputPath;
  } finally {
    // 5. Always close the browser when done
    await browser.close();
  }
};