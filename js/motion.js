// Motion de la capa cinematográfica (rediseño 2026).
//
// Todo acá es *progressive enhancement*: si GSAP no carga (CDN caído, sin
// red) o el usuario pidió menos movimiento, este archivo no hace nada y el
// sitio se ve completo igual. Ningún contenido depende de estas animaciones:
// lo que hacen es mover lo que ya está visible.

(function () {
  'use strict';

  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;
  var reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reducido || !gsap || !ScrollTrigger) return;

  gsap.registerPlugin(ScrollTrigger);

  // --- Intro del hero, sincronizada con el preloader -----------------------

  var yaInicio = false;

  function intro() {
    if (yaInicio) return;
    yaInicio = true;

    var timeline = gsap.timeline({ defaults: { ease: 'power3.out' } });
    var enPortada = !!document.querySelector('.hero-content');

    if (document.querySelector('.title-line__inner')) {
      timeline.from('.title-line__inner', { yPercent: 118, duration: 1, stagger: 0.1 }, 0.1);
    }

    if (enPortada) {
      timeline
        .from('.hero-content .eyebrow', { autoAlpha: 0, y: 18, duration: 0.6 }, 0)
        .from(
          '.hero-content .lead, .hero-actions, .hero-proof, .scroll-cue',
          { autoAlpha: 0, y: 24, duration: 0.75, stagger: 0.08 },
          '-=0.6',
        )
        .fromTo(
          '.hero-image-wrap',
          { clipPath: 'inset(100% 0% 0% 0%)' },
          { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.15, ease: 'power4.out' },
          0.15,
        )
        .from('.hero-caption, .hero-badge, .hero-vertical-note', { autoAlpha: 0, y: 22, duration: 0.7, stagger: 0.1 }, '-=0.55')
        .from('.hero-ghost', { autoAlpha: 0, xPercent: 6, duration: 1.4 }, 0.2);
    }

    // Páginas internas: el hero de página entra en bloque.
    if (document.querySelector('.page-hero')) {
      timeline.from(
        '.page-hero .eyebrow, .page-hero .lead, .page-hero__aside',
        { autoAlpha: 0, y: 24, duration: 0.7, stagger: 0.1 },
        0.15,
      );
    }
  }

  // El preloader avisa con este evento; si no llega, arrancamos igual.
  document.addEventListener('nocturna:reveal', intro);
  if (document.querySelector('[data-preloader].is-done')) intro();
  setTimeout(intro, 3200);

  // --- Parallax: el hero se mueve a otra velocidad que el scroll ------------

  if (document.querySelector('.hero-visual')) {
    gsap.to('.hero-visual', {
      yPercent: 7,
      ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.5 },
    });
  }

  if (document.querySelector('.hero-ghost')) {
    gsap.to('.hero-ghost', {
      xPercent: -9,
      ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.8 },
    });
  }

  // --- La galería entra de cerca a su lugar ---------------------------------
  // clearProps al terminar: si no, el transform en línea tapa el zoom del hover.

  gsap.utils.toArray('.gallery-item img').forEach(function (img) {
    gsap.from(img, {
      scale: 1.22,
      duration: 1.3,
      ease: 'power3.out',
      clearProps: 'transform',
      scrollTrigger: { trigger: img, start: 'top 92%', once: true },
    });
  });

  // --- Botones magnéticos (solo mouse; en celular no molesta) ---------------

  if (window.matchMedia('(pointer: fine)').matches) {
    document.querySelectorAll('.button, .nav-cta').forEach(function (element) {
      var moverX = gsap.quickTo(element, 'x', { duration: 0.45, ease: 'power3' });
      var moverY = gsap.quickTo(element, 'y', { duration: 0.45, ease: 'power3' });

      element.addEventListener('pointermove', function (event) {
        var caja = element.getBoundingClientRect();
        moverX((event.clientX - caja.left - caja.width / 2) * 0.16);
        moverY((event.clientY - caja.top - caja.height / 2) * 0.3);
      });

      element.addEventListener('pointerleave', function () {
        moverX(0);
        moverY(0);
        // Devolvemos el transform al CSS para que el hover siga mandando.
        gsap.delayedCall(0.45, function () {
          gsap.set(element, { clearProps: 'transform' });
        });
      });
    });
  }

  // --- Transición entre páginas ---------------------------------------------
  // Cortina que sube antes de navegar. Si algo falla, se navega igual: nunca
  // puede dejar al usuario atrapado en la página actual.

  function transiciones() {
    var overlay = document.createElement('div');
    overlay.className = 'page-transition';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.append(overlay);

    document.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      var link = event.target.closest('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      if (link.origin !== location.origin) return;
      // Ancla de la misma página: que scrollee, no que navegue.
      if (link.pathname === location.pathname && link.hash) return;
      if (link.href === location.href) return;

      var destino = link.href;

      try {
        event.preventDefault();
        gsap
          .timeline()
          .set(overlay, { transformOrigin: '50% 100%' })
          .to(overlay, { scaleY: 1, duration: 0.45, ease: 'power4.inOut' })
          .add(function () {
            window.location.href = destino;
          });
        setTimeout(function () {
          window.location.href = destino;
        }, 1500);
      } catch (error) {
        window.location.href = destino;
      }
    });

    // Vuelta desde el caché del navegador: la cortina no puede quedar tapando.
    window.addEventListener('pageshow', function () {
      gsap.set(overlay, { scaleY: 0 });
    });
  }

  transiciones();

  // Las imágenes cambian el alto del documento al cargar.
  window.addEventListener('load', function () {
    ScrollTrigger.refresh();
  });
})();
