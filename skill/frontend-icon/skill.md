---
name: frontend-icons-cdn
description: Always use open-source icon libraries delivered through trusted CDNs. Avoid embedding SVG icons directly unless absolutely necessary.
license: MIT
---

# Frontend Icons via Open Source CDN

Whenever designing or building a website, prioritize icons from well-known **open-source icon libraries** loaded through public CDNs instead of local icon files or manually written SVGs.

## Rules

- Always use icon libraries hosted on trusted CDNs.
- Never generate hundreds of inline SVG icons when a CDN library already provides them.
- Keep icon style consistent throughout the project.
- Prefer lightweight libraries with good browser compatibility.
- Icons should inherit the surrounding text color whenever possible.
- Use semantic icons that clearly represent their purpose.

## Preferred Libraries (Priority Order)

### 1. Lucide Icons (Recommended)

Reason:
- Modern
- Clean
- MIT License
- Lightweight
- Excellent for dashboards and SaaS

CDN

```html
<script src="https://unpkg.com/lucide@latest"></script>
```

Initialize

```javascript
lucide.createIcons();
```

Usage

```html
<i data-lucide="home"></i>
```

---

### 2. Bootstrap Icons

```html
<link
rel="stylesheet"
href="https://cdn.jsdelivr.net/npm/bootstrap-icons@latest/font/bootstrap-icons.min.css">
```

Example

```html
<i class="bi bi-house"></i>
```

---

### 3. Remix Icon

```html
<link
rel="stylesheet"
href="https://cdn.jsdelivr.net/npm/remixicon/fonts/remixicon.css">
```

Example

```html
<i class="ri-home-line"></i>
```

---

### 4. Font Awesome Free (Fallback)

```html
<link
rel="stylesheet"
href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css">
```

Example

```html
<i class="fa-solid fa-house"></i>
```

---

## Do

✔ Use CDN-hosted open-source icons.

✔ Keep one icon library for the entire project.

✔ Match icon size with typography.

✔ Use CSS to style colors.

✔ Prefer Lucide whenever possible.

## Don't

✘ Don't download icon packs into the repository unless explicitly requested.

✘ Don't mix multiple icon libraries without reason.

✘ Don't draw custom SVG icons for common UI actions.

✘ Don't convert icons into images.

## General Principle

For every web interface:

1. Choose one open-source icon library.
2. Load it via CDN.
3. Use its official class names or API.
4. Keep icon usage consistent across all pages.
5. Only create custom SVG icons when no suitable icon exists in the chosen library.

Default choice:
**Lucide Icons via CDN**.