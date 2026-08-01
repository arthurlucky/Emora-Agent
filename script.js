/* ===================================
   SCRIPT.JS - INTERACTIVE PORTFOLIO
   =================================== */

// ===================================
// 1. INITIALIZE LUCIDE ICONS
// ===================================
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
});

// ===================================
// 2. MOBILE NAVIGATION TOGGLE
// ===================================
const hamburger = document.querySelector('.hamburger');
const navMenu = document.querySelector('.nav-menu');

if (hamburger) {
    hamburger.addEventListener('click', () => {
        navMenu.classList.toggle('active');
        hamburger.classList.toggle('active');
    });
}

// Close menu when link is clicked
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
        navMenu.classList.remove('active');
        hamburger.classList.remove('active');
    });
});

// ===================================
// 3. SMOOTH SCROLL BEHAVIOR
// ===================================
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// ===================================
// 4. NAVBAR SCROLL EFFECT
// ===================================
const navbar = document.querySelector('.navbar');
window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
        navbar.style.background = 'rgba(10, 10, 10, 0.98)';
        navbar.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.5)';
    } else {
        navbar.style.background = 'rgba(10, 10, 10, 0.95)';
        navbar.style.boxShadow = 'none';
    }
});

// ===================================
// 5. INTERSECTION OBSERVER - FADE IN ON SCROLL
// ===================================
const observerOptions = {
    threshold: 0.15,
    rootMargin: '0px 0px -100px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('animate-in');
            observer.unobserve(entry.target);
        }
    });
}, observerOptions);

// Observe all animated elements
document.querySelectorAll('.work-card, .service-card, .testimonial-card').forEach(el => {
    observer.observe(el);
});

// ===================================
// 6. PARALLAX EFFECT ON HERO BLOBS
// ===================================
const blobs = document.querySelectorAll('.hero-blob');
window.addEventListener('mousemove', (e) => {
    const x = (window.innerWidth / 2 - e.clientX) / 100;
    const y = (window.innerHeight / 2 - e.clientY) / 100;
    
    blobs.forEach((blob, index) => {
        const offset = (index + 1) * 10;
        blob.style.transform = `translate(${x * offset}px, ${y * offset}px)`;
    });
});

// ===================================
// 7. ANIMATE COUNTERS ON SCROLL
// ===================================
function animateCounter(element, target) {
    let current = 0;
    const increment = target / 50;
    
    const updateCounter = () => {
        current += increment;
        if (current < target) {
            element.textContent = Math.floor(current) + (element.textContent.includes('+') ? '+' : '');
            requestAnimationFrame(updateCounter);
        } else {
            element.textContent = target + (element.textContent.includes('+') ? '+' : '');
        }
    };
    
    updateCounter();
}

const statsObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const stats = entry.target.querySelectorAll('.stat-number');
            stats.forEach(stat => {
                const value = parseInt(stat.textContent);
                animateCounter(stat, value);
            });
            statsObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.5 });

const aboutStats = document.querySelector('.about-stats');
if (aboutStats) {
    statsObserver.observe(aboutStats);
}

// ===================================
// 8. HOVER EFFECT ON WORK CARDS
// ===================================
document.querySelectorAll('.work-card').forEach(card => {
    card.addEventListener('mouseenter', function() {
        this.style.zIndex = '10';
    });
});

// ===================================
// 9. ACTIVE NAV LINK ON SCROLL
// ===================================
const navLinks = document.querySelectorAll('.nav-link');
const sections = document.querySelectorAll('section[id]');

window.addEventListener('scroll', () => {
    let current = '';
    
    sections.forEach(section => {
        const sectionTop = section.offsetTop;
        const sectionHeight = section.clientHeight;
        if (window.pageYOffset >= sectionTop - 200) {
            current = section.getAttribute('id');
        }
    });

    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href').slice(1) === current) {
            link.classList.add('active');
        }
    });
});

// Add active link styling
const style = document.createElement('style');
style.textContent = `
    .nav-link.active {
        color: #d4af37;
    }
`;
document.head.appendChild(style);

// ===================================
// 10. FORM SUBMISSION HANDLER (IF NEEDED)
// ===================================
document.querySelectorAll('form').forEach(form => {
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        console.log('Form submitted - add your form handler here');
        // You can add form submission logic here
    });
});

// ===================================
// 11. DYNAMIC YEAR IN FOOTER
// ===================================
const currentYear = new Date().getFullYear();
const footerText = document.querySelector('.footer-content p');
if (footerText) {
    footerText.textContent = `© ${currentYear} RELL. All rights reserved. Designed & crafted with intention.`;
}

// ===================================
// 12. SCROLL-TO-TOP BUTTON (OPTIONAL)
// ===================================
function createScrollToTopButton() {
    const button = document.createElement('button');
    button.innerHTML = '<i data-lucide="arrow-up"></i>';
    button.className = 'scroll-to-top';
    button.setAttribute('aria-label', 'Scroll to top');
    
    const buttonStyle = `
        position: fixed;
        bottom: 2rem;
        right: 2rem;
        width: 50px;
        height: 50px;
        background: #d4af37;
        color: #0a0a0a;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 999;
        transition: all 0.3s ease;
        box-shadow: 0 4px 20px rgba(212, 175, 55, 0.3);
    `;
    
    button.setAttribute('style', buttonStyle);
    document.body.appendChild(button);
    
    // Show button on scroll
    window.addEventListener('scroll', () => {
        if (window.scrollY > 300) {
            button.style.display = 'flex';
        } else {
            button.style.display = 'none';
        }
    });
    
    // Scroll to top on click
    button.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
    
    // Re-initialize lucide icons for the new button
    setTimeout(() => {
        lucide.createIcons();
    }, 100);
}

createScrollToTopButton();

// ===================================
// 13. LAZY LOAD IMAGES (IF USED)
// ===================================
function setupLazyLoading() {
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    img.src = img.dataset.src;
                    img.classList.add('loaded');
                    observer.unobserve(img);
                }
            });
        });

        document.querySelectorAll('img[data-src]').forEach(img => {
            imageObserver.observe(img);
        });
    }
}

setupLazyLoading();

// ===================================
// 14. SMOOTH SCROLL FOR HERO SCROLL INDICATOR
// ===================================
const heroScroll = document.querySelector('.hero-scroll');
if (heroScroll) {
    heroScroll.addEventListener('click', () => {
        const workSection = document.querySelector('#work');
        if (workSection) {
            workSection.scrollIntoView({ behavior: 'smooth' });
        }
    });
    heroScroll.style.cursor = 'pointer';
}

// ===================================
// 15. PAGE LOAD ANIMATION
// ===================================
window.addEventListener('load', () => {
    document.body.classList.add('loaded');
});

// ===================================
// 16. UTILITY: DEBOUNCE FUNCTION
// ===================================
function debounce(func, delay) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
}

// ===================================
// 17. RESPONSIVE ADJUSTMENTS ON RESIZE
// ===================================
window.addEventListener('resize', debounce(() => {
    // Recalculate any responsive layouts if needed
    console.log('Window resized');
}, 250));

// ===================================
// 18. KEYBOARD ACCESSIBILITY
// ===================================
document.addEventListener('keydown', (e) => {
    // Close mobile menu on Escape
    if (e.key === 'Escape') {
        if (navMenu) {
            navMenu.classList.remove('active');
            hamburger.classList.remove('active');
        }
    }
});

// ===================================
// 19. CONSOLE MESSAGE
// ===================================
console.log('%cWelcome to RELL\'s Portfolio', 'font-size: 24px; font-weight: bold; color: #d4af37; font-family: Cormorant Garamond;');
console.log('%cDesigned with intention. Built with precision.', 'font-size: 14px; color: #b8b8b8; font-family: DM Sans;');