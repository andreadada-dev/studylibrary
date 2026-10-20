import { test,expect } from '@playwright/test';
test.beforeEach(async({page})=>{
  // The visual smoke test exercises the app shell, not the availability of a CDN.
  await page.route(url=>url.hostname==='cdn.jsdelivr.net',route=>{
    const path=route.request().url();
    if (path.includes('supabase-js@2')) {
      return route.fulfill({status:200,contentType:'application/javascript',
        headers:{'access-control-allow-origin':'*'},
        body:'export const createClient = () => { throw new Error("Not configured in visual smoke"); };'});
    }
    if (path.includes('.css')) {
      return route.fulfill({status:200,contentType:'text/css',body:'/* CDN mock for smoke */'});
    }
    return route.fulfill({status:200,contentType:'application/javascript',body:'/* CDN mock for smoke */'});
  });
  await page.addInitScript(()=>{ window.STUDYLIBRARY_CONFIG={}; });
});


test('navigation and public catalog grid stay within viewport',async({page},testInfo)=>{
  await page.goto('/#/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('.topnav a')).toHaveCount(3);
  await expect(page.locator('.hero')).toBeVisible({timeout:25000});
  await expect(page.locator('.course-grid').first()).toHaveCount(1);
  const metrics=await page.evaluate(()=>({
    viewport:document.documentElement.clientWidth,
    scrollWidth:document.documentElement.scrollWidth,
    bodyWidth:document.body.scrollWidth
  }));
  expect(metrics.scrollWidth,JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.viewport+2);
  expect(metrics.bodyWidth,JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.viewport+2);
  await page.screenshot({path:testInfo.outputPath('home.png'),fullPage:true});
});

test('personal space and saved pages are understandable without login',async({page},testInfo)=>{
  await page.goto('/#/mine',{waitUntil:'domcontentloaded'});
  await expect(page.getByText('Salvataggio non disponibile')).toBeVisible({timeout:25000});
  await page.screenshot({path:testInfo.outputPath('mine.png'),fullPage:true});
  await page.goto('/#/saved',{waitUntil:'domcontentloaded'});
  await expect(page.getByText('Accedi per ritrovare il tuo studio')).toBeVisible({timeout:25000});
});

test('mobile navigation touch targets and visible links',async({page,isMobile})=>{
  await page.goto('/#/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('.topnav')).toBeVisible();
  const nav=page.locator('.topnav a');
  await expect(nav).toHaveCount(3);
  if (isMobile) {
    for(let i=0;i<3;i++){
      const rect=await nav.nth(i).boundingBox();
      expect(rect).not.toBeNull();
      expect(rect.width).toBeGreaterThanOrEqual(48);
      expect(rect.height).toBeGreaterThanOrEqual(30);
    }
  }
});
