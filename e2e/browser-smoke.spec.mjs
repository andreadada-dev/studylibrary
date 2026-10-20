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


test('six-dot handle drags catalog tiles without opening them',async({page})=>{
  await page.goto('/#/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('.hero')).toBeVisible({timeout:25000});
  await page.evaluate(async()=>{
    const grid=document.createElement('div');
    grid.id='drag-fixture';
    grid.style.cssText='display:grid;grid-template-columns:repeat(3,160px);gap:24px;margin:40px 12px;position:relative';
    grid.innerHTML=['alpha','beta','gamma'].map(id=>
      '<article class="personal-folder-tile" data-personal-catalog="'+id+'">' +
        '<div style="height:90px;background:#6655dd;border-radius:12px"></div>' +
        '<a href="#/catalog/'+id+'" class="personal-folder-edit">'+id+'</a>' +
        '<button class="personal-drag-handle" type="button" data-personal-drag aria-label="Sposta '+id+'">' +
          '<svg viewBox="0 0 16 20" width="16" height="20"><circle cx="5" cy="5" r="1.6"/><circle cx="11" cy="5" r="1.6"/></svg>' +
        '</button></article>').join('');
    document.body.appendChild(grid);
    const module=await import('/js/catalog-reorder.js');
    window.dragSaves=0;
    window.stopTestReorder=module.mountPersonalCatalogReorder(grid,{
      onSave:()=>{window.dragSaves++;},
      onAnnounce:message=>{window.dragAnnouncement=message;}
    });
  });
  const grip=page.locator('#drag-fixture [data-personal-catalog="alpha"] [data-personal-drag]');
  const target=page.locator('#drag-fixture [data-personal-catalog="beta"]');
  const start=await grip.boundingBox();
  const end=await target.boundingBox();
  await page.mouse.move(start.x+start.width/2,start.y+start.height/2);
  await page.mouse.down();
  await page.mouse.move(end.x+end.width/2,end.y+end.height/2,{steps:12});
  await page.mouse.up();
  await expect.poll(()=>page.locator('#drag-fixture [data-personal-catalog]').evaluateAll(nodes=>
    nodes.map(el=>el.dataset.personalCatalog))).toEqual(['beta','alpha','gamma']);
  expect(await page.evaluate(()=>window.dragSaves)).toBe(1);
  expect(page.url()).toContain('#/');
  // The same grip is keyboard accessible, without reinstating arrow buttons.
  await grip.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(()=>page.locator('#drag-fixture [data-personal-catalog]').evaluateAll(nodes=>
    nodes.map(el=>el.dataset.personalCatalog))).toEqual(['alpha','beta','gamma']);
  expect(await page.evaluate(()=>window.dragSaves)).toBe(2);
  await page.evaluate(()=>window.stopTestReorder());
});

test('touch pointer can reorder using the same grip',async({page})=>{
  await page.goto('/#/',{waitUntil:'domcontentloaded'});
  await page.evaluate(async()=>{
    const grid=document.createElement('div');
    grid.id='touch-drag-fixture';
    grid.style.cssText='display:flex;gap:20px;position:relative;margin:40px';
    grid.innerHTML=['one','two'].map(id=>
      '<article style="width:110px;height:100px" data-personal-catalog="'+id+'">' +
      '<button type="button" style="touch-action:none;width:44px;height:44px" data-personal-drag>'+id+'</button></article>').join('');
    document.body.appendChild(grid);
    const {mountPersonalCatalogReorder}=await import('/js/catalog-reorder.js');
    window.touchSaved=0;
    window.stopTouchReorder=mountPersonalCatalogReorder(grid,{onSave:()=>{window.touchSaved++;}});
    const handle=grid.querySelector('[data-personal-drag]');
    const target=grid.querySelector('[data-personal-catalog="two"]');
    const start=handle.getBoundingClientRect(),end=target.getBoundingClientRect();
    const props={bubbles:true,cancelable:true,pointerId:123,pointerType:'touch',isPrimary:true,button:0};
    handle.dispatchEvent(new PointerEvent('pointerdown',{...props,clientX:start.left+22,clientY:start.top+22}));
    document.dispatchEvent(new PointerEvent('pointermove',{...props,clientX:end.left+40,clientY:end.top+40}));
    document.dispatchEvent(new PointerEvent('pointerup',{...props,clientX:end.left+40,clientY:end.top+40}));
  });
  await expect.poll(()=>page.locator('#touch-drag-fixture [data-personal-catalog]').evaluateAll(nodes=>
    nodes.map(el=>el.dataset.personalCatalog))).toEqual(['two','one']);
  expect(await page.evaluate(()=>window.touchSaved)).toBe(1);
});
