(function () {
  var header = document.querySelector('.site-header');
  if (header && !header.classList.contains('no-hero')) {
    var onScroll = function () {
      if (window.scrollY > 40) header.classList.add('is-solid');
      else header.classList.remove('is-solid');
    };
    document.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  var toggle = document.querySelector('.nav-toggle');
  var panel = document.querySelector('.mobile-panel');
  if (toggle && panel) {
    toggle.addEventListener('click', function () {
      panel.classList.toggle('is-open');
      document.body.style.overflow = panel.classList.contains('is-open') ? 'hidden' : '';
    });
    panel.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        panel.classList.remove('is-open');
        document.body.style.overflow = '';
      });
    });
  }

  // Premium scroll-in reveal for images/cards as the guest scrolls the page.
  var revealTargets = document.querySelectorAll('.feature-media, .card, .masonry > img');
  if (revealTargets.length) {
    revealTargets.forEach(function (el, i) {
      el.classList.add('reveal');
      el.style.transitionDelay = (i % 3) * 0.1 + 's';
    });
    if ('IntersectionObserver' in window) {
      var revealIO = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              revealIO.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.15, rootMargin: '0px 0px -60px 0px' }
      );
      revealTargets.forEach(function (el) { revealIO.observe(el); });
    } else {
      revealTargets.forEach(function (el) { el.classList.add('is-visible'); });
    }
  }

  // Cards with a second (alt-angle) photo: tap the corner pill to swap
  // which image is showing, e.g. Dining/Lounge Cabana interior <-> exterior.
  var mediaToggles = document.querySelectorAll('.card-media-toggle');
  mediaToggles.forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var media = btn.closest('.card-media');
      if (!media) return;
      var imgs = media.querySelectorAll('img');
      if (imgs.length < 2) return;
      imgs.forEach(function (img) { img.classList.toggle('is-active'); });
      var showingAlt = !imgs[0].classList.contains('is-active');
      btn.textContent = showingAlt ? btn.getAttribute('data-label-alt') : btn.getAttribute('data-label-primary');
    });
  });

  // Homepage hero: slow crossfade between a few signature shots.
  var heroSlides = document.querySelectorAll('.hero .hero-slide');
  if (heroSlides.length > 1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var heroIdx = 0;
    setInterval(function () {
      heroSlides[heroIdx].classList.remove('is-active');
      heroIdx = (heroIdx + 1) % heroSlides.length;
      heroSlides[heroIdx].classList.add('is-active');
    }, 6000);
  }
})();

/* ---- Casita gallery lightbox ---- */
(function () {
  var galleries = document.querySelectorAll('[data-lightbox]');
  if (!galleries.length) return;
  var box = document.createElement('div');
  box.className = 'lightbox'; box.hidden = true;
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Photo viewer');
  box.innerHTML = '<img alt=""><button type="button" class="lb-close" aria-label="Close">&times;</button>' +
    '<button type="button" class="lb-prev" aria-label="Previous photo">&#8249;</button>' +
    '<button type="button" class="lb-next" aria-label="Next photo">&#8250;</button><div class="lb-count"></div>';
  document.body.appendChild(box);
  var img = box.querySelector('img'), count = box.querySelector('.lb-count'), items = [], idx = 0, lastFocus = null;
  function show(i) {
    idx = (i + items.length) % items.length;
    img.src = items[idx].href; img.alt = (items[idx].querySelector('img') || {}).alt || '';
    count.textContent = (idx + 1) + ' / ' + items.length;
  }
  function open(list, i) { items = list; lastFocus = document.activeElement; show(i); box.hidden = false; document.body.style.overflow = 'hidden'; box.querySelector('.lb-close').focus(); }
  function close() { box.hidden = true; document.body.style.overflow = ''; if (lastFocus) lastFocus.focus(); }
  galleries.forEach(function (g) {
    var list = Array.prototype.slice.call(g.querySelectorAll('a'));
    list.forEach(function (a, i) { a.addEventListener('click', function (e) { e.preventDefault(); open(list, i); }); });
  });
  box.querySelector('.lb-close').addEventListener('click', close);
  box.querySelector('.lb-prev').addEventListener('click', function () { show(idx - 1); });
  box.querySelector('.lb-next').addEventListener('click', function () { show(idx + 1); });
  box.addEventListener('click', function (e) { if (e.target === box) close(); });
  document.addEventListener('keydown', function (e) {
    if (box.hidden) return;
    if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft') show(idx - 1); else if (e.key === 'ArrowRight') show(idx + 1);
  });
  var sx = null;
  box.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
  box.addEventListener('touchend', function (e) { if (sx === null) return; var dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) show(idx + (dx < 0 ? 1 : -1)); sx = null; });
})();
