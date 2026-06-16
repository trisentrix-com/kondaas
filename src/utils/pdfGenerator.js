import os from 'os';
import puppeteer from 'puppeteer';

export const generatePDF = async (htmlContent, outputPath) => {
  // Determine if we are running on Linux (AWS) or Windows (Local)
  const isLinux = os.platform() === 'linux';
  
  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  };

  // 🔥 ONLY apply the hardcoded path if we are actually on the Linux production server!
  if (isLinux) {
    launchOptions.executablePath = '/usr/bin/chromium';
  }

  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent);
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true
    });
    return outputPath;
  } finally {
    await browser.close();
  }
};