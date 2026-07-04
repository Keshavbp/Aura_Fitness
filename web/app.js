// Interactive scripts for Aura Fitness Marketing Portal

document.addEventListener('DOMContentLoaded', () => {
  // Setup CTA Link Action Handlers
  const linkAndroidApk = document.getElementById('link-android-apk-alt');
  const linkIosBuild = document.getElementById('link-ios-build');
  const linkSourceCode = document.getElementById('link-source-code');

  if (linkAndroidApk) {
    linkAndroidApk.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = '/aura_fitness_prod_v1.0.4.apk';
    });
  }



  // Smooth scroll animations trigger
  const featureCards = document.querySelectorAll('.feature-card');
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  featureCards.forEach(card => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    card.style.transition = 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
    observer.observe(card);
  });

  // Mobile Navigation Drawer Toggle
  const btnMobileMenu = document.getElementById('btn-mobile-menu');
  const btnCloseMobileMenu = document.getElementById('btn-close-mobile-menu');
  const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
  const mobileDrawer = document.getElementById('mobile-drawer');
  const mobileNavLinks = document.querySelectorAll('.mobile-nav-link');

  const openMobileMenu = () => {
    if (mobileMenuOverlay && mobileDrawer) {
      mobileMenuOverlay.classList.remove('opacity-0', 'pointer-events-none');
      mobileMenuOverlay.classList.add('opacity-100', 'pointer-events-auto');
      mobileDrawer.classList.remove('translate-x-full');
      mobileDrawer.classList.add('translate-x-0');
      document.body.style.overflow = 'hidden';
    }
  };

  const closeMobileMenu = () => {
    if (mobileMenuOverlay && mobileDrawer) {
      mobileMenuOverlay.classList.remove('opacity-100', 'pointer-events-auto');
      mobileMenuOverlay.classList.add('opacity-0', 'pointer-events-none');
      mobileDrawer.classList.remove('translate-x-0');
      mobileDrawer.classList.add('translate-x-full');
      document.body.style.overflow = '';
    }
  };

  if (btnMobileMenu) {
    btnMobileMenu.addEventListener('click', openMobileMenu);
  }

  if (btnCloseMobileMenu) {
    btnCloseMobileMenu.addEventListener('click', closeMobileMenu);
  }

  if (mobileMenuOverlay) {
    mobileMenuOverlay.addEventListener('click', (e) => {
      if (e.target === mobileMenuOverlay) {
        closeMobileMenu();
      }
    });
  }

  mobileNavLinks.forEach(link => {
    link.addEventListener('click', closeMobileMenu);
  });
});
