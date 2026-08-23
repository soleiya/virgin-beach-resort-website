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
})();
