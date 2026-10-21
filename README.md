# Cub Scout Pack 3963 website

This repository contains the public website for Cub Scout Pack 3963 in Chicago. It is a static Jekyll site hosted with GitHub Pages.

## Site structure

- `index.html` and the other top-level HTML files contain each page's unique content.
- `_layouts/default.html` contains the shared document head, analytics, navigation, and footer.
- `_includes/` contains shared navigation, announcement, and footer markup.
- `_data/pack.yml` is the source of truth for contact, meeting, registration, and analytics details.
- `_data/events.yml` controls the event list, home-page feature, and announcement banner.
- `_data/navigation.yml` controls the site-wide navigation menu.
- `_data/photos.yml` controls which images appear in the photo gallery.
- `_config.yml` contains Jekyll settings and enables or disables the announcement.
- `assets/docs/` contains downloadable PDFs.
- `assets/images/pack3963photos/` contains web-ready gallery images.
- `base.css`, `layout.css`, `components.css`, `form.css`, and `responsive.css` make up the modular stylesheet system.
- `gallery.css` and `assets/js/gallery.js` contain the gallery presentation and lightbox behavior.
- `.pages.yml` lets Pack leadership edit Pack settings, events, and photos through Pages CMS.
- `.github/workflows/site-checks.yml` builds and validates every pull request automatically.

## Run the site locally

You need Ruby, Bundler, and Git.

```bash
git clone https://github.com/brandonweninger/pack3963.git
cd pack3963
bundle install
bundle exec jekyll serve
```

Open `http://localhost:4000` in a browser. Jekyll watches the files and rebuilds the site when they change.

## Common updates

### Change the announcement

The announcement comes from the event marked `featured: true` in `_data/events.yml`. Edit its `announcement` value in Pages CMS or YAML. Use `_config.yml` only to enable or disable the banner:

```yaml
announcement_enabled: true
announcement_link: "/events.html"
```

Set `announcement_enabled` to `false` to hide the banner.

### Change the navigation

Edit `_data/navigation.yml`. Because the pages use `_includes/nav.html`, one change updates the navigation across the site.

### Change Pack contact or meeting details

Edit `_data/pack.yml` or select **Pack Settings** in Pages CMS. These values update every page and the shared footer.

### Update events

Edit `_data/events.yml` or select **Events** in Pages CMS. The Events page is generated from this file. The single event marked as featured also appears on the home page and supplies the announcement banner.

### Update page content

Edit the relevant top-level HTML file, such as `join.html` or `resources.html`. Keep the YAML front matter and `layout: default` at the top of each page. Shared document markup belongs in `_layouts/default.html` or an include.

### Add or manage photos

Authorized leaders can open `admin.html`, sign in to Pages CMS, and select **Photo Gallery**. For each public photo:

1. Upload a JPG, JPEG, PNG, or WebP image.
2. Write a concise, descriptive image description for visitors using screen readers.
3. Add an optional caption and event date.
4. Confirm the Pack has permission to publish the image.
5. Do not include a child's full name in public text or image metadata.

The gallery source of truth is `_data/photos.yml`. Gallery images should be web-sized, use safe lowercase filenames, and have location and camera metadata removed before they are committed.

## Publishing

GitHub Pages publishes changes from the `main` branch. Use a branch and pull request for updates:

```bash
git switch -c update/short-description
git add .
git commit -m "Describe the website update"
git push -u origin update/short-description
```

Open a pull request on GitHub, review the preview or checks, and merge it into `main`. Allow GitHub Pages a few minutes to rebuild the public site.

The **Site checks** workflow builds the Jekyll site and runs `scripts/validate_site.rb`. It catches missing local links, incomplete event/photo data, unsafe new-tab links, duplicate page wrappers, and unwanted repository files.

### Cloudflare Workers builds

The website Worker `pack3963` uses the root `wrangler.jsonc` to serve the Jekyll output in `_site`. Its empty `previews` block enables isolated branch previews. In Cloudflare's Workers Builds settings, both production and preview builds must run `bundle exec ruby -EUTF-8 -S jekyll build --strict_front_matter` before their existing `npx wrangler deploy` or `npx wrangler preview` command. The explicit UTF-8 setting prevents Sass from rejecting Unicode characters under the build environment's default US-ASCII encoding. Workers Builds does not run a Wrangler custom build command from the configuration file.

The authentication/email Worker is a separate service. Deploy it using `workers/auth-email/wrangler.jsonc`; do not point the website build at that configuration. Deployment configuration, Worker source, and database migrations are excluded from the public Jekyll output.

## Before opening a pull request

- Run `bundle exec jekyll build` and confirm it completes without errors.
- Open the changed pages on both desktop and mobile widths.
- Test internal links, downloads, navigation, forms, and the photo lightbox.
- Confirm every image has useful alternative text.
- Confirm links opened in a new tab include `rel="noopener noreferrer"`.
- Do not commit `.DS_Store`, `_site`, cache, or local dependency files.

## Key maintenance notes

- Keep new styles in the appropriate modular CSS file; do not create a second all-in-one stylesheet.
- Store downloadable documents in `assets/docs/`.
- Store only web-ready gallery images in the site repository. Keep original full-resolution photos in the Pack's private storage.
- Never commit passwords, access tokens, private member data, or confidential documents.

