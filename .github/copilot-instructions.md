# GitHub Copilot Instructions for Engineering ePortfolio

## Project Overview
This is a personal engineering portfolio website for Aidan Korpar, hosted on GitHub Pages. The site showcases professional experience, leadership, academic experience, teamwork, and capabilities.

## Technology Stack
- **Frontend**: Pure HTML5, CSS3, and vanilla JavaScript
- **Hosting**: GitHub Pages (static site)
- **No build process**: Direct HTML/CSS/JS files served as-is

## Project Structure
- `index.html` - Main page: a white, scroll-driven 3D robot cell. Detail write-ups live in `<template>` elements
- `cell.js` - Three.js scene: robot, inverse kinematics, scroll timeline and HTML cards mapped onto boards
- `site.js` / `site.css` - Navigation, detail sheets and styling for the main page
- `frames/` - Pre-rendered WebP frames used on desktops without GPU acceleration. Re-render with `node tools/render-frames.mjs` whenever the robot, cell layout, lighting or timeline in `cell.js` changes (the page refuses stale frames and falls back to lite 3D). Each render goes in a new version folder; delete the old one
- `warehouse/` - The earlier robot fabrication cell site (secondary page, not linked from the main page). `?cell=briefcase` loads the first robot workcell; its Classic View toggle shows the original standard web page
- `images/` - Portfolio images and assets (`images/thumbs/` holds small versions for the main page)
- `pdfs/` - Resume and other downloadable documents
- `_redirects` / `_headers` - Cloudflare Pages redirects (old `/3dRobot` links) and cache headers
- `favicon.png` - Site favicon

## Coding Standards

### HTML
- Use semantic HTML5 elements
- Maintain clean, properly indented structure
- Keep accessibility in mind (ARIA labels, alt text, semantic tags)
- Ensure mobile-responsive design with proper meta viewport tags

### CSS
- Use existing class naming conventions found in style.css
- Maintain consistency with current styling patterns
- Use flexbox and CSS Grid for layouts
- Ensure responsive design works across all device sizes
- Keep styles organized by section

### JavaScript
- Keep JavaScript minimal and vanilla (no frameworks)
- Use modern ES6+ syntax
- Ensure cross-browser compatibility
- Add appropriate event listeners for interactive elements

## Design Guidelines
- Maintain professional appearance suitable for an engineering portfolio
- Ensure consistent color scheme and typography
- Keep navigation intuitive and accessible
- Optimize images for web (performance matters)
- Test responsive design on mobile, tablet, and desktop

## Accessibility Requirements
- Provide alt text for all images
- Ensure proper heading hierarchy (h1, h2, h3, etc.)
- Maintain sufficient color contrast ratios
- Support keyboard navigation
- Include ARIA labels where appropriate

## Content Guidelines
- Portfolio content should be professional and relevant to engineering
- Keep personal information (email, phone, LinkedIn) up to date
- Ensure all links are functional
- PDF documents should be accessible and downloadable

## Testing & Validation
- Test in multiple browsers (Chrome, Firefox, Safari, Edge)
- Validate HTML using W3C validator
- Check responsive design at various breakpoints
- Test all navigation links and interactive elements
- Verify PDF downloads work correctly

## Best Practices
- Keep code clean and well-commented where necessary
- Optimize for page load speed
- Ensure SEO-friendly markup
- Use descriptive file names for images and assets
- Maintain git history with clear commit messages

## When Making Changes
- Always preserve existing functionality unless explicitly asked to change it
- Test changes locally before committing
- Ensure changes don't break responsive design
- Keep the professional tone and appearance of the portfolio
- Verify all links and downloads still work after changes
