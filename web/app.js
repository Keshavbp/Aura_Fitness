// Interactive scripts for Aura Fitness Marketing Portal

document.addEventListener('DOMContentLoaded', () => {
  // Setup CTA Link Action Handlers
  const linkAndroidApk = document.getElementById('link-android-apk');
  const linkIosBuild = document.getElementById('link-ios-build');
  const linkSourceCode = document.getElementById('link-source-code');

  if (linkAndroidApk) {
    linkAndroidApk.addEventListener('click', (e) => {
      e.preventDefault();
      alert("AURA FITNESS - Android APK Download\n\nRedirecting to build server package: aura_fitness_prod_v1.0.4.apk\n(Note: This will download the Expo standalone Android build once your EAS pipeline compiles it.)");
    });
  }

  if (linkIosBuild) {
    linkIosBuild.addEventListener('click', (e) => {
      e.preventDefault();
      alert("AURA FITNESS - iOS TestFlight Track\n\nOpening Apple TestFlight Invitation for Alpha testers.\n(Requires iOS 15.0+ with camera access enabled.)");
    });
  }

  if (linkSourceCode) {
    linkSourceCode.addEventListener('click', (e) => {
      e.preventDefault();
      alert("AURA FITNESS - Developer Repository\n\nOpening project codebase repository link. Clone files, run 'npm install', and boot using 'npx expo start' to check native emulators.");
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
});
