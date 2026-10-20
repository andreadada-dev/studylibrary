import { paginateBook, bookCover, bookPaper } from './book-pagination.js';

const FLIP_SOURCES=[
  '/js/vendor/page-flip.browser.js',
  'https://cdn.jsdelivr.net/npm/page-flip@2.0.7/dist/js/page-flip.browser.min.js'
];
let libraryPromise;

export function loadStPageFlip() {
  if (window.St?.PageFlip) return Promise.resolve(window.St.PageFlip);
  if (libraryPromise) return libraryPromise;
  libraryPromise=(async()=>{
    for (const url of FLIP_SOURCES) {
      try {
        const constructor=await new Promise((resolve,reject)=>{
          const script=document.createElement('script');
          script.src=url;
          script.async=true;
          let finished=false;
          const done=error=>{
            if (finished) return;
            finished=true;
            clearTimeout(timer);
            if (error) {
              script.remove();
              reject(error);
            } else resolve(window.St.PageFlip);
          };
          const timer=setTimeout(()=>done(new Error('Timeout StPageFlip')),6500);
          script.onload=()=>window.St?.PageFlip
            ? done()
            : done(new Error('StPageFlip non inizializzato'));
          script.onerror=()=>done(new Error('Bundle StPageFlip non raggiungibile'));
          document.head.appendChild(script);
        });
        return constructor;
      } catch (error) {
        console.warn('PageFlip fallback:',url,error.message);
      }
    }
    throw new Error('Il libro 3D non è disponibile. Puoi comunque continuare a leggere.');
  })().catch(error=>{
    libraryPromise=null;
    throw error;
  });
  return libraryPromise;
}

export function createStudyBook(reader, {onNotice = () => {}} = {}) {
  const view=reader.querySelector('[data-book-view]');
  const stage=view?.querySelector('[data-book-stage]');
  const status=view?.querySelector('[data-book-status]');
  const pageLabel=view?.querySelector('[data-book-count]');
  const prev=view?.querySelector('[data-book-prev]');
  const next=view?.querySelector('[data-book-next]');
  if (!view || !stage) return null;

  let instance=null, active=false, disposed=false, generation=0, currentPage=0;
  let refreshTimer=0, hideTimer=0;
  const controls = reader.querySelector('.reader-view-controls');
  const nav = view.querySelector('.reader-book-nav');

  function showControls() {
    if (!active || disposed) return;
    reader.classList.remove('book-controls-hidden');
    clearTimeout(hideTimer);
    hideTimer=setTimeout(hideControls,2900);
  }
  function hideControls() {
    if (!active || disposed) return;
    const focused=document.activeElement;
    const panel=reader.querySelector('[data-reader-panel]');
    if ((focused && (controls?.contains(focused) || nav?.contains(focused))) ||
        (panel && !panel.hidden) || controls?.matches(':hover') || nav?.matches(':hover')) {
      clearTimeout(hideTimer);
      hideTimer=setTimeout(hideControls,1300);
      return;
    }
    reader.classList.add('book-controls-hidden');
  }
  function onPointerMove(event) {
    if (!active || event.pointerType==='touch') return;
    showControls();
  }
  function onPointerDown() { showControls(); }
  function onFocusIn() { showControls(); }
  function onFocusOut() { if (active) showControls(); }
  function onVisibilityChange() {
    if (document.visibilityState === 'visible' && active) showControls();
  }

  const getPageCount=()=>instance?.getPageCount?.() || 0;

  function drawStatus(message) {
    if (status) {
      status.textContent=message || '';
      status.hidden=!message;
    }
  }
  function drawButtons() {
    const total=getPageCount();
    const index=instance?.getCurrentPageIndex?.() ?? currentPage;
    currentPage=index;
    if (pageLabel) pageLabel.textContent=(total ? index+1 : 0) + ' / ' + total;
    if (prev) prev.disabled=!active || index <= 0;
    if (next) next.disabled=!active || index >= total-1;
  }

  function measurePage() {
    const screenWidth = window.visualViewport?.width || window.innerWidth;
    const screenHeight = window.visualViewport?.height || window.innerHeight;
    // Navigation and settings float ABOVE the book; they take no page space.
    const narrow = screenWidth < 760;
    const widthAvailable = Math.max(230,screenWidth-(narrow?14:42));
    const heightAvailable = Math.max(330,screenHeight-(narrow?24:48));
    const pageWidth = narrow
      ? Math.floor(widthAvailable)
      : Math.floor(Math.min((widthAvailable-12)/2,heightAvailable/1.34));
    const pageHeight = narrow
      ? Math.floor(Math.min(heightAvailable,Math.max(380,pageWidth*1.64)))
      : Math.floor(Math.min(heightAvailable,pageWidth*1.34));
    return {width:Math.max(225,pageWidth),height:Math.max(300,pageHeight)};
  }

  async function rebuild({preserve = true} = {}) {
    if (!active || disposed) return;
    const ticket=++generation;
    if (preserve && instance) currentPage=instance.getCurrentPageIndex();
    const saved=currentPage;
    const settings=measurePage();
    stage.style.minHeight=(settings.height+18)+'px';
    drawStatus('Sto impaginando la lezione…');
    try {
      const PageFlip=await loadStPageFlip();
      if (!active || disposed || ticket!==generation) return;
      // KaTeX/images in the source have already been rendered by the lesson reader.
      await Promise.race([
        document.fonts?.ready || Promise.resolve(),
        new Promise(resolve=>setTimeout(resolve,1100))
      ]);
      if (!active || disposed || ticket!==generation) return;
      instance?.destroy?.();
      instance=null;
      stage.replaceChildren();
      const fragments=document.createDocumentFragment();
      const title=reader.querySelector('.reader-header .topic-title')?.textContent?.trim() || 'Lezione';
      const subtitle=reader.querySelector('.reader-kicker')?.textContent?.replace(/\s+/g,' ').trim() || '';
      const first=bookCover({...settings,title,subtitle});
      fragments.appendChild(first);
      const pages=paginateBook(reader,fragments,{...settings,label:title});
      // A rigid front/back cover needs an even number of interior faces so
      // landscape spreads can turn completely (including one-page lessons).
      if (pages.length % 2 === 1) {
        const closing=bookPaper({...settings,number:pages.length+1,label:title});
        closing.classList.add('book-closing-page');
        closing.querySelector('.book-paper-body').innerHTML =
          '<div class="book-closing-message"><span>FINE ARGOMENTO</span>' +
          '<strong>Il prossimo capitolo ti aspetta.</strong></div>';
        fragments.appendChild(closing);
      }
      fragments.appendChild(bookCover({...settings,title,back:true}));
      if (!active || disposed || ticket!==generation) return;
      // PageFlip.destroy() REMOVES its root element. Give each render a
      // disposable inner root so the persistent stage can survive repagination.
      const flipRoot=document.createElement('div');
      flipRoot.className='book-flip-mount';
      const widthForBook=window.visualViewport?.width || window.innerWidth;
      const hasRoomForSpread=widthForBook >= settings.width*2 + 2;
      flipRoot.style.width=(hasRoomForSpread ? settings.width*2 : settings.width)+'px';
      flipRoot.style.height=settings.height+'px';
      stage.appendChild(flipRoot);
      flipRoot.appendChild(fragments);
      const paperElements=[...flipRoot.querySelectorAll('.book-paper')];
      const reduced=window.matchMedia?.('(prefers-reduced-motion:reduce)').matches;
      const flip=new PageFlip(flipRoot,{
        width:settings.width,height:settings.height,
        size:'fixed',showCover:true,usePortrait:true,autoSize:false,
        drawShadow:true,maxShadowOpacity:.54,
        flippingTime:reduced?100:820,
        mobileScrollSupport:true,swipeDistance:24,
        clickEventForward:true,disableFlipByClick:true,
        startPage:Math.min(Math.max(0,saved),pages.length+(pages.length%2 ? 2 : 1))
      });
      flip.on('flip',event=>{
        currentPage=event.data;
        drawButtons();
      });
      flip.on('changeOrientation',()=>drawButtons());
      flip.loadFromHTML(paperElements);
      instance=flip;
      drawStatus('');
      drawButtons();
    } catch(error) {
      console.error('StPageFlip failed:',error);
      if (active && !disposed && ticket===generation) {
        active=false;
        view.hidden=true;
        reader.classList.remove('reader-book-active');
        document.body.classList.remove('reading-book-mode');
        instance?.destroy?.();
        instance=null;
        stage.replaceChildren();
        onNotice(error.message+' Rimane disponibile la lettura continua.');
      }
    }
  }

  const scheduleRefresh=()=>{
    if (!active || disposed) return;
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(()=>void rebuild(),320);
  };

  function onKeyDown(event) {
    if (!active || disposed || !document.body.classList.contains('reading-focus-mode')) return;
    if (event.altKey || event.ctrlKey || event.metaKey ||
        event.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
    if (event.key==='ArrowLeft' || event.key==='ArrowRight') {
      showControls();
      event.preventDefault();
      if (event.key==='ArrowLeft') instance?.flipPrev?.();
      else instance?.flipNext?.();
    }
  }

  function onViewClick(event) {
    const answer=event.target.closest?.('[data-reveal]');
    if (!answer) return;
    const box=answer.closest('.checkpoint');
    if (!box) return;
    event.preventDefault();
    box.classList.toggle('open');
    answer.textContent=box.classList.contains('open')?'Nascondi risposta':'Mostra risposta';
  }

  let observedWidth=0;
  const observer=typeof ResizeObserver!=='undefined'
    ? new ResizeObserver(entries=>{
        const width=Math.round(entries[0]?.contentRect.width || 0);
        if (Math.abs(width-observedWidth)>3) {
          observedWidth=width;
          scheduleRefresh();
        }
      }) : null;

  prev?.addEventListener('click',()=>{ instance?.flipPrev?.(); showControls(); });
  next?.addEventListener('click',()=>{ instance?.flipNext?.(); showControls(); });
  document.addEventListener('pointermove',onPointerMove,{passive:true});
  reader.addEventListener('pointerdown',onPointerDown,{passive:true});
  reader.addEventListener('focusin',onFocusIn);
  reader.addEventListener('focusout',onFocusOut);
  document.addEventListener('visibilitychange',onVisibilityChange);
  view.addEventListener('click',onViewClick);
  document.addEventListener('keydown',onKeyDown);
  window.addEventListener('resize',scheduleRefresh);

  return {
    get active(){return active;},
    get pages(){return getPageCount();},
    get index(){return currentPage;},
    async enable() {
      if (disposed || active) return;
      active=true;
      view.hidden=false;
      reader.classList.add('reader-book-active');
      document.body.classList.add('reading-book-mode');
      observedWidth=Math.round(reader.getBoundingClientRect().width);
      observer?.observe(reader);
      currentPage=0;
      showControls();
      await rebuild({preserve:false});
      showControls();
    },
    disable() {
      if (!active) return;
      active=false;
      generation++;
      clearTimeout(refreshTimer);
      clearTimeout(hideTimer);
      reader.classList.remove('book-controls-hidden');
      observer?.disconnect();
      instance?.destroy?.();
      instance=null;
      stage.replaceChildren();
      reader.classList.remove('reader-book-active');
      document.body.classList.remove('reading-book-mode');
      view.hidden=true;
      drawStatus('');
    },
    refresh: scheduleRefresh,
    destroy() {
      if (disposed) return;
      this.disable();
      disposed=true;
      observer?.disconnect();
      document.removeEventListener('keydown',onKeyDown);
      window.removeEventListener('resize',scheduleRefresh);
      view.removeEventListener('click',onViewClick);
      document.removeEventListener('pointermove',onPointerMove);
      reader.removeEventListener('pointerdown',onPointerDown);
      reader.removeEventListener('focusin',onFocusIn);
      reader.removeEventListener('focusout',onFocusOut);
      document.removeEventListener('visibilitychange',onVisibilityChange);
      clearTimeout(hideTimer);
    }
  };
}
