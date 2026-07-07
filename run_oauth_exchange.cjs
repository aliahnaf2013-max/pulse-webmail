/* eslint-disable */
const { chromium } = require('playwright');
const fs = require('fs');

const clientId = 'TdlM0FPnS7C8H7vqefhaQ';
const clientSecret = 'Vv0IsvoUOaoLXE7Tp9X9XwQu86Z5LMyi';
const authUrl = 'https://zoom.us/oauth/authorize?response_type=code&client_id=TdlM0FPnS7C8H7vqefhaQ&redirect_uri=https://agent-hub.pulsebusiness.ai/oauth/zoom/callback';

async function main() {
  console.log("Connecting to Microsoft Edge on port 9224...");
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9224');
  const context = browser.contexts()[0];
  
  let code = null;
  let targetPage = null;
  
  console.log("Opening clean new tab...");
  const mainPage = await context.newPage();
  targetPage = mainPage;
  
  mainPage.on('framenavigated', async (frame) => {
    if (frame === mainPage.mainFrame()) {
      const url = frame.url();
      console.log(`Main tab navigated: ${url}`);
      if (url.includes('code=')) {
        const urlObj = new URL(url);
        code = urlObj.searchParams.get('code');
        console.log(`Captured authorization code: ${code}`);
      }
    }
  });
  
  context.on('page', (newPage) => {
    console.log(`New tab opened: ${newPage.url()}`);
    targetPage = newPage;
    newPage.on('framenavigated', async (frame) => {
      if (frame === newPage.mainFrame()) {
        const url = frame.url();
        console.log(`Popup tab navigated: ${url}`);
        if (url.includes('code=')) {
          const urlObj = new URL(url);
          code = urlObj.searchParams.get('code');
          console.log(`Captured authorization code: ${code}`);
        }
      }
    });
  });
  
  console.log(`Navigating to OAuth Authorization URL: ${authUrl}...`);
  await mainPage.goto(authUrl);
  
  console.log("Waiting for authorization code capture...");
  for (let i = 0; i < 30; i++) {
    await mainPage.waitForTimeout(1000);
    
    if (code) break;
    
    if (targetPage) {
      const u = targetPage.url();
      if (u.includes('oauth/authorize') || u.includes('authorization') || u.includes('zoom.us/oauth/signin')) {
        const allowBtn = targetPage.locator('button:has-text("Allow"), button:has-text("Authorize"), button:has-text("Agree"), button:has-text("Allow access")').first();
        if (await allowBtn.isVisible()) {
          console.log(`Consent button found on page ${targetPage.url()}. Clicking 'Allow'...`);
          await allowBtn.click();
        }
      }
    }
  }
  
  if (!code) {
    console.error("Failed to capture authorization code.");
    await mainPage.screenshot({ path: 'zoom_auth_code_error.png' });
    console.log("Saved error screenshot to zoom_auth_code_error.png");
    await browser.close();
    process.exit(1);
  }
  
  console.log(`Exchanging code ${code} for tokens...`);
  const tokenUrl = 'https://zoom.us/oauth/token';
  const authHeader = btoa(`${clientId}:${clientSecret}`);
  
  const params = new URLSearchParams();
  params.set('grant_type', 'authorization_code');
  params.set('code', code);
  params.set('redirect_uri', 'https://agent-hub.pulsebusiness.ai/oauth/zoom/callback');
  
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authHeader}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });
  
  const text = await response.text();
  console.log("Token Response status:", response.status);
  console.log("Token Response body:", text);
  
  if (response.ok) {
    const tokens = JSON.parse(text);
    fs.writeFileSync('/Users/aliahnaf/SourceControl/agent-hub/scratch/zoom_tokens.json', JSON.stringify(tokens, null, 2));
    console.log("Tokens written to /Users/aliahnaf/SourceControl/agent-hub/scratch/zoom_tokens.json");
  }
  
  await mainPage.close();
  await browser.close();
}

main().catch(console.error);
