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
