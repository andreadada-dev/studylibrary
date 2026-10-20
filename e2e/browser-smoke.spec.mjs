import { test,expect } from '@playwright/test';
import { resolve } from 'node:path';
test.beforeEach(async({page})=>{
  // Exercise the REAL pinned StPageFlip bundle, not a fake page-turn mock.
  await page.route('**/js/vendor/page-flip.browser.js',route=>route.fulfill({
    status:200,contentType:'application/javascript',
    path:resolve(process.cwd(),'node_modules/page-flip/dist/js/page-flip.browser.js')
  }));
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
  await grip.scrollIntoViewIfNeeded();
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
    grid.scrollIntoView({block:'center'});
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

test('reader focus mode changes layout and Aa changes text only',async({page},testInfo)=>{
  await page.goto('/#/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('.hero')).toBeVisible({timeout:25000});
  await page.evaluate(async()=>{
    const {lessonTopicArticle,wireReaderInteractions}=await import('/js/ui.js');
    const topic={
      id:'pixel-resolution',title:'Risoluzione spaziale',summary:'I pixel rappresentano la risoluzione di una immagine.',
      sections:[{id:'concept',type:'concept',title:'Che cosa sono i pixel',
        body:'I pixel rappresentano piccole informazioni. Questo concetto aiuta a comprendere la visione artificiale.'}]
    };
    const lesson={slug:'intro',id:'intro',title:'Introduzione',topics:[topic],modules:[{id:'intro',topicIds:[topic.id]}]};
    const library={slug:'cv',title:'Computer Vision',lessons:[lesson]};
    const catalog={slug:'computer-vision',title:'Computer Vision',libraries:[library]};
    const context={catalog,library,lesson};
    document.querySelector('#app').innerHTML=
      '<div class="page"><header class="course-hero"><h1>Lezione 01</h1></header>' +
      '<div class="course-layout"><aside class="topic-rail">Indice argomenti</aside>' +
      lessonTopicArticle(context,topic) + '</div></div>';
    wireReaderInteractions();
  });
  // The HTML shell must actually load the dedicated stylesheet, not render
  // unstyled native buttons when an asset is missing from the production image.
  const cssResponse=await page.request.get('/styles-study.css');
  expect(cssResponse.status()).toBe(200);
  expect(await cssResponse.text()).toContain('.reader-view-controls');
  const stylesheetLoaded=await page.evaluate(()=>{
    const sheet=[...document.styleSheets].find(item=>item.href?.includes('/styles-study.css'));
    return !!sheet && [...sheet.cssRules].length>0;
  });
  expect(stylesheetLoaded).toBe(true);
  const hero=page.locator('.course-hero');
  const toggle=page.locator('[data-reader-focus]');
  const settings=page.locator('[data-reader-settings]');
  const text=page.locator('.reader .lesson-section p').first();
  await expect(toggle).toBeVisible();
  await expect(hero).toBeVisible();
  const initialToolbar=await page.locator('.reader-view-controls').evaluate(el=>({
    display:getComputedStyle(el).display,
    buttonRadius:getComputedStyle(el.querySelector('[data-reader-focus]')).borderRadius,
    panelHidden:getComputedStyle(el.querySelector('[data-reader-panel]')).display
  }));
  expect(initialToolbar.display).toBe('flex');
  expect(initialToolbar.buttonRadius).not.toBe('0px');
  expect(initialToolbar.panelHidden).toBe('none');
  const initialSize=await text.evaluate(el=>getComputedStyle(el).fontSize);
  await settings.click();
  await expect(page.locator('[data-reader-panel]')).toBeVisible();
  await page.locator('[data-reader-zoom="1"]').click();
  expect(await text.evaluate(el=>getComputedStyle(el).fontSize)).not.toBe(initialSize);
  await toggle.click();
  await expect(page.locator('body')).toHaveClass(/reading-focus-mode/);
  await expect(page.locator('.reader-book-view')).toBeVisible({timeout:18000});
  await expect(page.locator('.reader-book-stage .stf__parent')).toBeVisible({timeout:18000});
  await expect.poll(()=>page.locator('.reader-book-stage .book-paper').count()).toBeGreaterThanOrEqual(3);
  const readerBackground=await page.locator('.reader').evaluate(el=>getComputedStyle(el).backgroundColor);
  expect(readerBackground).toBe('rgba(0, 0, 0, 0)');
  await expect(hero).toBeHidden();
  await expect(page.locator('.topic-rail')).toBeHidden();
  if (page.viewportSize().width > 380) await expect(page.locator('.reader-focus-context')).toBeVisible();
  else await expect(page.locator('.reader-focus-context')).toBeHidden();
  await expect(page.locator('[data-reader-panel]')).toBeHidden();
  expect(await page.locator('.reader').evaluate(el=>getComputedStyle(el).zoom)).toBe('1');
  await expect(toggle.locator('[data-reader-focus-label]')).toHaveText('Esci');
  await expect(page.locator('[data-reader-book-label]')).toHaveText('Scorrimento');
  await page.screenshot({path:testInfo.outputPath('book-3d-open.png'),fullPage:true});
  await expect(page.locator('[data-book-count]')).not.toHaveText('0 / 0');
  await page.locator('[data-book-next]').click();
  await expect(page.locator('[data-book-count]')).not.toHaveText('1 / 3');
  // Continuous reading stays available and has no blank page.
  await page.locator('[data-reader-book-toggle]').click();
  await expect(page.locator('.reader-book-view')).toBeHidden();
  await expect(page.locator('.reader-header')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('reader-focus.png'),fullPage:true});
  await toggle.click();
  await expect(page.locator('body')).not.toHaveClass(/reading-focus-mode/);
  await expect(hero).toBeVisible();
});

test('long lesson text is paginated with intact words and a usable book',async({page})=>{
  await page.goto('/#/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('.hero')).toBeVisible({timeout:25000});
  const result=await page.evaluate(async()=>{
    const {paginateBook,bookSourceBlocks}=await import('/js/book-pagination.js');
    const reader=document.createElement('article');
    reader.className='reader';
    const phrase='La risoluzione spaziale si misura in pixel. ';
    const words=phrase.repeat(180);
    reader.innerHTML='<header class="reader-header"><h2 class="topic-title">Introduzione</h2></header>' +
      '<section class="lesson-section"><h3>Spiegazione</h3><p>'+words+'</p>' +
      '<p><strong>Una formula importante</strong> descrive come si contano i pixel.</p></section>' +
      '<section class="checkpoint"><h3>Domanda finale</h3><button data-reveal>Mostra risposta</button>' +
      '<div class="checkpoint-answer">Sono milioni di pixel.</div></section>';
    document.body.appendChild(reader);
    const mount=document.createElement('div');
    document.body.appendChild(mount);
    let result;
    try {
      const pages=paginateBook(reader,mount,{width:320,height:440,label:'Introduzione'});
      const bodyText=pages.map(p=>p.querySelector('.book-paper-body').textContent.replace(/\s+/g,' ')).join(' ');
      result={
        pages:pages.length,
        phraseCount:(bodyText.match(/La risoluzione spaziale/g)||[]).length,
        lastQuestion:bodyText.includes('Domanda finale'),
        formatted:!!mount.querySelector('strong')
      };
    } finally {reader.remove();mount.remove();}
    return result;
  });
  expect(result.pages).toBeGreaterThan(2);
  expect(result.phraseCount).toBe(180);
  expect(result.lastQuestion).toBe(true);
  expect(result.formatted).toBe(true);
});
