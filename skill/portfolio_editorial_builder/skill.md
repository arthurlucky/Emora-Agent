---
name: portfolio-editorial-builder
description: Build premium editorial-style portfolio websites with dark luxury aesthetics, cinematic hero sections, asymmetrical layouts, and smooth animations
author: EMORA Skill Factory (hasil generasi otomatis)
version: 1.0.0
---

# Portfolio Editorial Builder

Skill ini memandu pembuatan portfolio website premium dengan aesthetic editorial magazine—bold typography, intentional layouts, dark luxury theme, dan interaktif tanpa dependencies eksternal.

## Deskripsi

Portfolio editorial adalah website yang menggabungkan prinsip desain majalah premium dengan fungsionalitas modern. Hasilnya terasa seperti karya agensi kreatif—bukan template generic.

**Tech Stack:** HTML5 + CSS3 + Vanilla JavaScript + Google Fonts + Lucide Icons CDN

## Kapan Menggunakan Skill Ini

- Membangun portfolio personal/profesional dengan aesthetic premium
- Membuat landing page untuk agensi kreatif/desain
- Menginginkan dark luxury theme dengan gold accents
- Perlu responsive design (mobile, tablet, desktop)
- Ingin smooth animations tanpa framework JS (React, Vue, dll)
- Tidak ada budget untuk dependencies eksternal

## Struktur Project

```
portfolio/
├── index.html       # Semantic HTML5, 310 baris
├── style.css        # Dark luxury theme, 946 baris
├── script.js        # Interactive features, 337 baris
└── test_responsive.html  # Verification report (opsional)
```

## Langkah-Langkah Implementasi

### 1. Setup HTML Semantik (index.html)

**Elemen Utama:**
- Navigation: Fixed navbar dengan blur effect
- Hero Section: 2-column layout (desktop) dengan animated gradient blobs
- Work Section: Asymmetrical grid, featured card spans 2 columns
- About Section: Split layout (visual + content)
- Services Section: 6-card grid
- Testimonials Section: Client quotes cards
- Contact Section: Contact info cards
- Footer: Links & copyright

**Best Practices:**
- Gunakan semantic HTML5 (`<header>`, `<section>`, `<article>`, `<footer>`)
- Load Google Fonts (Cormorant Garamond + DM Sans)
- Integrasikan Lucide Icons via CDN: `<script src="https://unpkg.com/lucide@latest"></script>`
- Gunakan data-lucide attributes untuk icons: `<i data-lucide="home"></i>`

### 2. Design System CSS (style.css)

**Color Palette (Dark Luxury):**
```css
--dark-bg: #0a0a0a;              /* Luxury black */
--dark-secondary: #1a1a1a;       /* Card bg */
--accent-gold: #d4af37;          /* Primary accent */
--accent-burgundy: #722f37;      /* Warm accent */
--accent-wine: #8b3a3a;          /* Gradient */
--text-primary: #f5f5f5;         /* Main text */
--text-secondary: #b8b8b8;       /* Secondary text */
```

**Typography:**
```css
--font-serif: 'Cormorant Garamond', serif;  /* Display, headings */
--font-sans: 'DM Sans', sans-serif;         /* Body, UI */
```

**Spacing System (8px baseline):**
```css
--spacing-xs: 0.5rem;   /* 8px */
--spacing-sm: 1rem;     /* 16px */
--spacing-md: 2rem;     /* 32px */
--spacing-lg: 4rem;     /* 64px */
--spacing-xl: 6rem;     /* 96px */
--spacing-xxl: 8rem;    /* 128px */
```

**Key CSS Features:**
- CSS Variables untuk maintainability
- Grid & Flexbox untuk responsive layouts
- Smooth transitions (cubic-bezier)
- Gradient overlays pada hover
- Glassmorphism navbar (backdrop-filter: blur)

### 3. Interaktif JavaScript (script.js)

**Features Implemented:**

1. **Icon Initialization**
   ```javascript
   lucide.createIcons();
   ```

2. **Mobile Navigation**
   - Hamburger menu toggle
   - Close on link click atau Escape key

3. **Smooth Scroll**
   - Anchor links navigation
   - Scroll-to-top button dinamis

4. **Scroll Effects**
   - Intersection Observer untuk fade-in animations
   - Parallax blobs pada mousemove (hero section)
   - Navbar blur effect deepens on scroll

5. **Counter Animations**
   - Animate stats/numbers saat scroll ke section

6. **Active Link Tracking**
   - Highlight nav link berdasarkan scroll position

7. **Lazy Loading Support**
   - IntersectionObserver untuk images

8. **Accessibility**
   - Keyboard navigation (Escape key close menu)
   - ARIA labels
   - Semantic HTML

### 4. Responsive Breakpoints

**Desktop (1025px+)**
- Full 2-column hero
- Featured work card spans 2 columns
- Services 3-column grid
- Parallax effects active

**Tablet (768px - 1024px)**
- Hero 1-column
- Work cards 1-column
- Services 2-column
- About split maintained

**Mobile (480px & below)**
- Single column layouts
- Hamburger menu visible
- Touch-friendly buttons
- Responsive typography (clamp)
- Footer centered

## Animasi & Effects

**CSS Animations:**
- `fadeInUp`: Elements slide up saat masuk viewport
- `slideInLeft`: About visual masuk dari kiri
- `bounce`: Hero scroll indicator
- `float`: Animated gradient blobs

**JavaScript Effects:**
- Parallax blobs follow mouse
- Navbar backdrop blur intensity
- Counter number animations
- Smooth scroll behavior

## Color Usage Guide

| Element | Color | Usage |
|---------|-------|-------|
| Background | #0a0a0a | Main bg, premium feel |
| Accent | #d4af37 | Buttons, links, highlights |
| Burgundy | #722f37 | Gradient, hover states |
| Text | #f5f5f5 | Primary text |
| Muted | #b8b8b8 | Secondary text |

## Customization Tips

**1. Ganti Color Palette**
```css
:root {
    --accent-gold: #your-color;
    --accent-burgundy: #your-color;
    /* Update semua colors */
}
```

**2. Ganti Typography**
```html
<!-- Di <head> -->
<link href="https://fonts.googleapis.com/css2?family=YourSerif&family=YourSans&display=swap" rel="stylesheet">
```

```css
--font-serif: 'Your Serif', serif;
--font-sans: 'Your Sans', sans-serif;
```

**3. Tambah Sections**
- Copy structure dari section existing
- Update class names & IDs
- Add navigation link

**4. Replace Placeholder Content**
- Work cards: Replace gradient placeholders dengan images
- About section: Tambah image ke `about-visual`
- Contact: Update email & social links

## Performance Optimization

- ✓ Lazy loading images (data-src attribute)
- ✓ Debounced scroll handler
- ✓ CSS animations (GPU accelerated)
- ✓ No heavy JavaScript libraries
- ✓ Optimized media queries
- ✓ Minifiable HTML/CSS/JS

## Accessibility Compliance

- ✓ Semantic HTML5 structure
- ✓ ARIA labels pada buttons
- ✓ Keyboard navigation (Tab, Escape)
- ✓ Color contrast meets WCAG AA
- ✓ Touch-friendly target sizes (50px min)
- ✓ Focus indicators on interactive elements

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Mobile)

*Note: IntersectionObserver & CSS Grid required*

## Contoh Penggunaan

```bash
# 1. Create project folder
mkdir my-portfolio
cd my-portfolio

# 2. Copy files (index.html, style.css, script.js)

# 3. Open in browser
open index.html

# 4. Customize colors, fonts, content

# 5. Deploy (Vercel, Netlify, GitHub Pages, dll)
```

## Troubleshooting

**Icons tidak tampil?**
- Pastikan Lucide CDN loaded: `<script src="https://unpkg.com/lucide@latest"></script>`
- Call `lucide.createIcons()` di script

**Mobile menu tidak close?**
- Check hamburger event listener di script.js
- Pastikan nav-menu punya class `active` saat toggle

**Animations tidak smooth?**
- Inspect CSS transitions & animations
- Check browser console untuk errors
- Reduce animation complexity jika performa rendah

**Responsivitas broken?**
- Pastikan viewport meta tag ada: `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
- Check CSS media queries di style.css
- Test di DevTools device emulation

## Resources

- [Google Fonts](https://fonts.google.com)
- [Lucide Icons](https://lucide.dev)
- [MDN CSS Grid](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Grid_Layout)
- [MDN Intersection Observer](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)

## Next Steps

1. Customize colors & fonts sesuai brand identity
2. Replace placeholder content dengan project portfolio
3. Add real images ke work section
4. Setup contact form (form submission handler)
5. Deploy ke hosting (Vercel, Netlify, GitHub Pages)
6. Setup analytics (Google Analytics, Plausible)
7. Add SEO meta tags & structured data
8. Test accessibility dengan screen readers